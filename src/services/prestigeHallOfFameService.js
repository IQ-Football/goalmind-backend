/**
 * Prestige & Hall of Fame Service
 * 
 * Implements:
 * - Prestige reset (GOAT tier → 1200 ELO, gain star, unlock Hall of Fame slot)
 * - Hall of Fame curation (store/retrieve curated matches & trivia)
 */

import { getTierForElo } from './iqStatusService.js';

const GOAT_ELO_THRESHOLD = 2401;
const PRESTIGE_BASE_ELO = 1200;

// ─── PRESTIGE RESET ───────────────────────────────────────────────────────────

export async function prestigeUser(fastify, userId) {
  // Get current user
  const userResult = await fastify.db.query(
    `SELECT id, username, elo, prestige_stars FROM users WHERE id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) {
    return { success: false, error: 'USER_NOT_FOUND' };
  }
  const user = userResult.rows[0];

  // Must be GOAT tier
  if (user.elo < GOAT_ELO_THRESHOLD) {
    return { 
      success: false, 
      error: 'NOT_GOAT', 
      message: `Must have ELO ≥ ${GOAT_ELO_THRESHOLD} to prestige. Current ELO: ${user.elo}`,
      requiredElo: GOAT_ELO_THRESHOLD,
      currentElo: user.elo,
    };
  }

  // Check if user already has a Hall of Fame entry (each prestige = 1 slot)
  const hofResult = await fastify.db.query(
    `SELECT COUNT(*) as count FROM user_hall_of_fame WHERE user_id = $1`,
    [userId]
  );
  const currentSlots = Number(hofResult.rows[0].count) || 0;
  const expectedStars = (user.prestige_stars || 0) + 1;
  
  // Should not have more entries than stars (safety check)
  if (currentSlots >= expectedStars) {
    return {
      success: false,
      error: 'SLOT_ALREADY_USED',
      message: `No new Hall of Fame slot available. You have ${currentSlots} slots and ${expectedStars - 1} stars.`,
    };
  }

  const oldElo = user.elo;
  const newPrestigeStars = (user.prestige_stars || 0) + 1;

  // Reset ELO to 1200
  await fastify.db.query(
    `UPDATE users SET elo = $1, prestige_stars = $2, last_active_at = NOW() WHERE id = $3`,
    [PRESTIGE_BASE_ELO, newPrestigeStars, userId]
  );

  // Update Redis leaderboard
  await fastify.redis.zadd('leaderboard:global', PRESTIGE_BASE_ELO, userId);

  // Invalidate IQ profile cache
  await fastify.redis.del(`iq:${userId}`);

  const newTier = getTierForElo(PRESTIGE_BASE_ELO);

  return {
    success: true,
    data: {
      oldElo,
      newElo: PRESTIGE_BASE_ELO,
      oldTier: 'GOAT',
      newTier: newTier.name,
      prestigeStars: newPrestigeStars,
      hallOfFameSlotUnlocked: currentSlots + 1,
      message: `Prestige successful! You are now ${newTier.name} with ${newPrestigeStars} prestige star(s). Your Hall of Fame slot #${currentSlots + 1} is unlocked.`,
    },
  };
}

// ─── HALL OF FAME ─────────────────────────────────────────────────────────────

export async function ensureHallOfFameTable(fastify) {
  const sql = `
    CREATE TABLE IF NOT EXISTS user_hall_of_fame (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_index    INTEGER NOT NULL,
      item_type     VARCHAR(20) NOT NULL,  -- 'match' | 'trivia_set' | 'achievement'
      item_id       VARCHAR(100) NOT NULL, -- match_id, trivia_set_id, or achievement_id
      title         VARCHAR(200) NOT NULL,
      comment       TEXT,
      relic_metadata JSONB,                -- { year, significance, tags[] }
      is_public     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, slot_index)
    )
  `;
  try {
    await fastify.db.query(sql);
    // Index
    await fastify.db.query(
      `CREATE INDEX IF NOT EXISTS idx_hof_user_slot ON user_hall_of_fame(user_id, slot_index)`
    );
  } catch (err) {
    fastify.log.error('ensureHallOfFameTable:', err.message);
  }
}

export async function addToHallOfFame(fastify, userId, data) {
  const { slotIndex, itemType, itemId, title, comment, relicMetadata } = data;

  // Verify user has enough prestige stars for this slot
  const userResult = await fastify.db.query(
    `SELECT prestige_stars FROM users WHERE id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) {
    return { success: false, error: 'USER_NOT_FOUND' };
  }
  const stars = userResult.rows[0].prestige_stars || 0;
  
  if (slotIndex > stars) {
    return {
      success: false,
      error: 'SLOT_LOCKED',
      message: `Slot ${slotIndex} is locked. Prestige to unlock more slots. You have ${stars} star(s) = ${stars} slot(s).`,
    };
  }

  // Check slot already filled
  const existing = await fastify.db.query(
    `SELECT id FROM user_hall_of_fame WHERE user_id = $1 AND slot_index = $2`,
    [userId, slotIndex]
  );
  if (existing.rows.length > 0) {
    return {
      success: false,
      error: 'SLOT_FILLED',
      message: `Slot ${slotIndex} already has an entry. Use PUT to update or delete first.`,
    };
  }

  const result = await fastify.db.query(
    `INSERT INTO user_hall_of_fame (user_id, slot_index, item_type, item_id, title, comment, relic_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, slot_index, item_type, item_id, title, comment, relic_metadata, created_at`,
    [userId, slotIndex, itemType, itemId, title, comment || null, relicMetadata || null]
  );

  // Invalidate IQ profile cache
  await fastify.redis.del(`iq:${userId}`);

  return { success: true, data: result.rows[0] };
}

export async function getUserHallOfFame(fastify, targetUserId, requestingUserId) {
  // Get user's prestige stars (to show locked slots)
  const userResult = await fastify.db.query(
    `SELECT prestige_stars FROM users WHERE id = $1`,
    [targetUserId]
  );
  const prestigeStars = userResult.rows[0]?.prestige_stars || 0;

  // Get all public entries + own entries if viewing own profile
  const isOwnProfile = requestingUserId === targetUserId;
  const entriesResult = await fastify.db.query(
    `SELECT id, slot_index, item_type, item_id, title, comment, relic_metadata, created_at
     FROM user_hall_of_fame
     WHERE user_id = $1 AND (is_public = true OR $2::boolean = true)
     ORDER BY slot_index ASC`,
    [targetUserId, isOwnProfile]
  );

  // Build slots (filled + locked)
  const slots = [];
  for (let i = 1; i <= prestigeStars; i++) {
    const entry = entriesResult.rows.find(e => e.slot_index === i);
    if (entry) {
      slots.push({
        slotIndex: i,
        status: 'filled',
        entry: {
          id: entry.id,
          itemType: entry.item_type,
          itemId: entry.item_id,
          title: entry.title,
          comment: entry.comment,
          relicMetadata: entry.relic_metadata,
          createdAt: entry.created_at,
        },
      });
    } else {
      slots.push({ slotIndex: i, status: 'empty', entry: null });
    }
  }

  // Locked slots beyond stars
  for (let i = prestigeStars + 1; i <= prestigeStars + 2; i++) {
    slots.push({ slotIndex: i, status: 'locked', entry: null });
  }

  return {
    success: true,
    data: {
      userId: targetUserId,
      prestigeStars,
      totalSlots: prestigeStars,
      filledSlots: entriesResult.rows.length,
      slots,
    },
  };
}

export async function removeFromHallOfFame(fastify, userId, slotIndex) {
  const result = await fastify.db.query(
    `DELETE FROM user_hall_of_fame WHERE user_id = $1 AND slot_index = $2 RETURNING id`,
    [userId, slotIndex]
  );
  if (result.rows.length === 0) {
    return { success: false, error: 'ENTRY_NOT_FOUND' };
  }
  await fastify.redis.del(`iq:${userId}`);
  return { success: true };
}

// ─── PROFILE INTEGRATION ─────────────────────────────────────────────────────

export async function getHallOfFameCount(fastify, userId) {
  const result = await fastify.db.query(
    `SELECT COUNT(*) as count FROM user_hall_of_fame WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rows[0].count) || 0;
}