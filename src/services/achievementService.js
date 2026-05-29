/**
 * Achievement Service — Automated Glory
 * Handles badge awarding logic and status automation
 */

const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';
const FOUNDING_PRO_ID = '550e8400-e29b-41d4-a716-446655440001';
const FOUNDING_RECRUITER_ID = '550e8400-e29b-41d4-a716-446655440002';
const FOUNDING_CAPTAIN_ID = '550e8400-e29b-41d4-a716-446655440003';
const ETERNAL_TITAN_ID = '550e8400-e29b-41d4-a716-446655440007';
const FOUNDING_THRESHOLD = 10;

/**
 * Award a specific badge to a user
 */
export async function awardBadge(fastify, userId, achievementId) {
  try {
    const result = await fastify.db.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING *`,
      [userId, achievementId]
    );

    if (result.rows.length > 0) {
      fastify.log.info({ userId, achievementId }, 'Achievement awarded automatically');
      return true;
    }
    return false;
  } catch (err) {
    fastify.log.error({ err, userId, achievementId }, 'Error awarding achievement');
    throw err;
  }
}

/**
 * Check if a user qualifies for the Founding General badge based on their tribe join position
 */
export async function checkAndAwardFoundingBadge(fastify, userId, tribeId) {
  if (!tribeId) return;

  try {
    // We get the join position for this user in this tribe.
    // In our simplified model, we use the total number of members in that tribe who joined at or before this user's registration.
    // However, since we don't have a reliable 'joined_at' in tribe_members for re-sync, 
    // and the counter 'waitlist_signups' is the source of truth for the cap,
    // a manual call will check the current count and award if it's within the threshold.
    
    const countResult = await fastify.db.query(
      `SELECT COUNT(*)::int as count 
       FROM user_achievements ua
       JOIN users u ON ua.user_id = u.id
       WHERE ua.achievement_id = $1 AND u.tribe_id = $2`,
      [FOUNDING_GENERAL_ID, tribeId]
    );

    const currentCount = countResult.rows[0].count;

    if (currentCount < FOUNDING_THRESHOLD) {
      await awardBadgeWithTribeCap(fastify, userId, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD);
      return true;
    }
    return false;
  } catch (err) {
    fastify.log.error({ err, userId, tribeId }, 'Error checking founding badge qualify');
  }
}

/**
 * Award a specific badge to a user with a strict per-tribe cap
 * This uses a transaction and row-level locking on the tribe to ensure atomicity.
 */
export async function awardBadgeWithTribeCap(fastify, userId, achievementId, cap = 10, force = false) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Get user's tribe and lock it to prevent race conditions for this tribe's badges
    const userResult = await client.query(
      'SELECT tribe_id FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const tribeId = userResult.rows[0]?.tribe_id;

    if (!tribeId) {
      await client.query('ROLLBACK');
      return false;
    }

    // 2. Count existing badges of this type for this tribe (unless forced)
    if (!force) {
      const countResult = await client.query(
        `SELECT COUNT(*)::int as count 
         FROM user_achievements ua
         JOIN users u ON ua.user_id = u.id
         WHERE ua.achievement_id = $1 AND u.tribe_id = $2`,
        [achievementId, tribeId]
      );

      const currentCount = countResult.rows[0].count;

      if (currentCount >= cap) {
        await client.query('ROLLBACK');
        fastify.log.info({ userId, achievementId, tribeId, currentCount }, 'Tribe achievement cap reached');
        return false;
      }
    }

    // 3. Award the badge
    const result = await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING *`,
      [userId, achievementId]
    );

    await client.query('COMMIT');

    if (result.rows.length > 0) {
      fastify.log.info({ userId, achievementId, tribeId, forced: force }, 'Achievement awarded with tribe cap');
      return true;
    }
    return false;
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId, achievementId }, 'Error awarding achievement with cap');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Award a specific badge to a user with a global cap
 */
export async function awardBadgeWithGlobalCap(fastify, userId, achievementId, cap = 100) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Count existing badges globally
    const countResult = await client.query(
      'SELECT COUNT(*)::int as count FROM user_achievements WHERE achievement_id = $1',
      [achievementId]
    );

    const currentCount = countResult.rows[0].count;

    if (currentCount >= cap) {
      await client.query('ROLLBACK');
      fastify.log.info({ userId, achievementId, currentCount }, 'Global achievement cap reached');
      return false;
    }

    // 2. Award the badge
    const result = await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING *`,
      [userId, achievementId]
    );

    await client.query('COMMIT');

    if (result.rows.length > 0) {
      fastify.log.info({ userId, achievementId, globalCount: currentCount + 1 }, 'Achievement awarded with global cap');
      return true;
    }
    return false;
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId, achievementId }, 'Error awarding achievement with global cap');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check if a user has a specific achievement
 */
export async function hasAchievement(fastify, userId, achievementId) {
  try {
    const result = await fastify.db.query(
      'SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [userId, achievementId]
    );
    return result.rows.length > 0;
  } catch (err) {
    fastify.log.error({ err, userId, achievementId }, 'Error checking achievement');
    return false;
  }
}

/**
 * Award the Founding General badge manually with metadata updates
 */
export async function awardFoundingGeneral(fastify, userId, force = false) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Get user's tribe
    const userResult = await client.query(
      'SELECT tribe_id FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const tribeId = userResult.rows[0]?.tribe_id;

    if (!tribeId) {
      await client.query('ROLLBACK');
      fastify.log.error({ userId }, 'User has no tribe, cannot award Founding General');
      return { success: false, reason: 'no_tribe' };
    }

    // 1.5 Lock the tribe to ensure unique signup numbers for this tribe
    await client.query('SELECT id FROM tribes WHERE id = $1 FOR UPDATE', [tribeId]);

    // 1.6 Check if user already has the badge
    const existingBadge = await client.query(
      'SELECT earned_at FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [userId, FOUNDING_GENERAL_ID]
    );

    let signupNumber;
    if (existingBadge.rows.length > 0) {
      // User already has it, we check if they have a signup number in metadata
      const existingMetadata = await client.query(
        "SELECT metadata->'badges'->'founding_general'->>'signup_number' as num FROM users WHERE id = $1",
        [userId]
      );
      if (existingMetadata.rows[0]?.num) {
        signupNumber = parseInt(existingMetadata.rows[0].num);
      } else {
        // If they have the badge but no number, we'll assign one or keep it as is
        // For simplicity, we'll just continue and re-assign (or keep current count)
      }
    }

    if (!signupNumber) {
      // 2. Determine signup number by looking at the highest existing number for this tribe
      const maxResult = await client.query(
        `SELECT MAX((COALESCE(u.metadata->'badges'->'founding_general'->>'signup_number', '0'))::int) as max_val
         FROM users u
         WHERE u.tribe_id = $1`,
        [tribeId]
      );

      const maxSignupNumber = maxResult.rows[0].max_val || 0;

      // Check cap if not forced AND user doesn't already have the badge
      if (existingBadge.rows.length === 0 && !force && maxSignupNumber >= FOUNDING_THRESHOLD) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cap_reached', count: maxSignupNumber };
      }

      signupNumber = maxSignupNumber + 1;
    }

    // 3. Award the badge (if not already awarded)
    await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, FOUNDING_GENERAL_ID]
    );

    // 4. Update tribe_members and users metadata
    const badgeData = {
      asset: '/assets/badges/founding_general.png',
      signup_number: signupNumber,
      flair_name: 'Ancient Scroll'
    };

    await client.query(`
      UPDATE tribe_members
      SET is_founding_general = true,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(metadata->'badges', '{}'::jsonb) || jsonb_build_object('founding_general', $1::jsonb))
      WHERE user_id = $2
    `, [JSON.stringify(badgeData), userId]);

    await client.query(`
      UPDATE users
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(metadata->'badges', '{}'::jsonb) || jsonb_build_object('founding_general', $1::jsonb))
      WHERE id = $2
    `, [JSON.stringify(badgeData), userId]);

    await client.query('COMMIT');
    fastify.log.info({ userId, tribeId, signupNumber }, 'Founding General badge manually awarded with metadata');
    
    return { success: true, signupNumber };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Error awarding Founding General badge');
    throw err;
  } finally {
    client.release();
  }
}

export { FOUNDING_GENERAL_ID, FOUNDING_PRO_ID, FOUNDING_RECRUITER_ID, FOUNDING_CAPTAIN_ID, FOUNDING_THRESHOLD };
