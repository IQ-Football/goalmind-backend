/**
 * Achievement Service — Automated Glory
 * Handles badge awarding logic and status automation
 */

const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';
const FOUNDING_PRO_ID = '550e8400-e29b-41d4-a716-446655440001';
const FOUNDING_RECRUITER_ID = '550e8400-e29b-41d4-a716-446655440002';
const FOUNDING_CAPTAIN_ID = '550e8400-e29b-41d4-a716-446655440003';
const FOUNDING_CENTURION_ID = '660e8400-e29b-41d4-a716-446655440001';
const ETERNAL_TITAN_ID = '550e8400-e29b-41d4-a716-446655440007';
const SURGE_25K_ID = '770e8400-e29b-41d4-a716-446655440001';
const FOUNDING_THRESHOLD = 10;
const CENTURION_THRESHOLD = 100;
const SURGE_25K_MIN = 23388;
const SURGE_25K_MAX = 25000;

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
    // Check if they already have it
    const hasFG = await hasAchievement(fastify, userId, FOUNDING_GENERAL_ID);
    if (hasFG) return false;

    // Use the robust manual awarding logic which handles metadata and caps
    const result = await awardFoundingGeneral(fastify, userId);
    return result.success;
  } catch (err) {
    fastify.log.error({ err, userId, tribeId }, 'Error checking founding badge qualify');
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
      }
    }

    if (!signupNumber) {
      // 2. Determine signup number based on their registration rank in the tribe
      const rankResult = await client.query(
        `WITH tribe_ranks AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rank
          FROM users
          WHERE tribe_id = $1
        )
        SELECT rank FROM tribe_ranks WHERE id = $2`,
        [tribeId, userId]
      );
      
      const userRank = rankResult.rows[0]?.rank;

      if (!userRank) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'user_not_in_tribe_ranks' };
      }

      // Check cap if not forced AND user doesn't already have the badge
      if (existingBadge.rows.length === 0 && !force && userRank > FOUNDING_THRESHOLD) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cap_reached', count: userRank - 1 };
      }

      signupNumber = userRank;
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
      INSERT INTO tribe_members (user_id, tribe_id, is_founding_general, metadata)
      VALUES ($1, $2, true, jsonb_build_object('badges', jsonb_build_object('founding_general', $3::jsonb)))
      ON CONFLICT (user_id) DO UPDATE
      SET is_founding_general = true,
          metadata = COALESCE(tribe_members.metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(tribe_members.metadata->'badges', '{}'::jsonb) || jsonb_build_object('founding_general', $3::jsonb))
    `, [userId, tribeId, JSON.stringify(badgeData)]);

    await client.query(`
      UPDATE users
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(metadata->'badges', '{}'::jsonb) || jsonb_build_object('founding_general', $1::jsonb))
      WHERE id = $2
    `, [JSON.stringify(badgeData), userId]);

    await client.query('COMMIT');
    fastify.log.info({ userId, tribeId, signupNumber }, 'Founding General badge awarded with metadata');
    
    return { success: true, signupNumber };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Error awarding Founding General badge');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Award the Founding Centurion badge (signups 11-100)
 */
export async function awardFoundingCenturion(fastify, userId, force = false) {
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
      return { success: false, reason: 'no_tribe' };
    }

    // Lock tribe
    await client.query('SELECT id FROM tribes WHERE id = $1 FOR UPDATE', [tribeId]);

    // Check if user already has it
    const existingBadge = await client.query(
      'SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [userId, FOUNDING_CENTURION_ID]
    );

    let signupNumber;
    if (existingBadge.rows.length > 0) {
      const existingMetadata = await client.query(
        "SELECT metadata->'badges'->'founding_centurion'->>'signup_number' as num FROM users WHERE id = $1",
        [userId]
      );
      if (existingMetadata.rows[0]?.num) {
        signupNumber = parseInt(existingMetadata.rows[0].num);
      }
    }

    if (!signupNumber) {
      const maxResult = await client.query(
        `SELECT MAX((COALESCE(tm.metadata->'badges'->'founding_centurion'->>'signup_number', '10'))::int) as max_val
         FROM tribe_members tm
         WHERE tm.tribe_id = $1`,
        [tribeId]
      );

      const maxSignupNumber = Math.max(maxResult.rows[0].max_val || 10, 10);

      if (existingBadge.rows.length === 0 && !force && maxSignupNumber >= CENTURION_THRESHOLD) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cap_reached', count: maxSignupNumber };
      }

      signupNumber = maxSignupNumber + 1;
    }

    // Award badge
    await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, FOUNDING_CENTURION_ID]
    );

    const badgeData = {
      asset: '/assets/badges/founding_centurion.png',
      signup_number: signupNumber,
      flair_name: 'Silver Shield'
    };

    await client.query(`
      INSERT INTO tribe_members (user_id, tribe_id, metadata)
      VALUES ($1, $2, jsonb_build_object('badges', jsonb_build_object('founding_centurion', $3::jsonb)))
      ON CONFLICT (user_id) DO UPDATE
      SET metadata = COALESCE(tribe_members.metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(tribe_members.metadata->'badges', '{}'::jsonb) || jsonb_build_object('founding_centurion', $3::jsonb))
    `, [userId, tribeId, JSON.stringify(badgeData)]);

    await client.query(`
      UPDATE users
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(metadata->'badges', '{}'::jsonb) || jsonb_build_object('founding_centurion', $1::jsonb))
      WHERE id = $2
    `, [JSON.stringify(badgeData), userId]);

    await client.query('COMMIT');
    fastify.log.info({ userId, tribeId, signupNumber }, 'Founding Centurion badge awarded');
    
    return { success: true, signupNumber };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Error awarding Founding Centurion badge');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Award a specific badge to a user with a strict per-tribe cap
 * This uses a transaction and row-level locking on the tribe to ensure atomicity.
 */
export async function awardBadgeWithTribeCap(fastify, userId, achievementId, cap = 10, force = false) {
  // If it's Founding General, use the specialized function
  if (achievementId === FOUNDING_GENERAL_ID) {
    const res = await awardFoundingGeneral(fastify, userId, force);
    return res.success;
  }
  
  // If it's Founding Centurion, use the specialized function
  if (achievementId === FOUNDING_CENTURION_ID) {
    const res = await awardFoundingCenturion(fastify, userId, force);
    return res.success;
  }

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
 * Check and award the 25k Surge badge based on global signup count
 */
export async function checkAndAwardSurgeBadge(fastify, userId) {
  try {
    // We use the redis counter for global count if available, otherwise fallback to DB
    let count;
    if (fastify.redis) {
      const redisCount = await fastify.redis.get('users:total_count');
      count = parseInt(redisCount);
    }

    if (!count) {
      const dbResult = await fastify.db.query('SELECT COUNT(*)::int as count FROM users');
      count = dbResult.rows[0].count;
    }

    if (count >= SURGE_25K_MIN && count <= SURGE_25K_MAX) {
      return await awardBadge(fastify, userId, SURGE_25K_ID);
    }
    return false;
  } catch (err) {
    fastify.log.error({ err, userId }, 'Error checking surge badge');
    return false;
  }
}

/**
 * Backfill Surge badge for users who signed up during the window
 */
export async function backfillSurgeBadges(fastify) {
  try {
    // Better: Get the IDs of the users in that range
    const windowResult = await fastify.db.query(
      `WITH ranked_users AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as signup_number
        FROM users
      )
      SELECT id FROM ranked_users 
      WHERE signup_number BETWEEN $1 AND $2`,
      [SURGE_25K_MIN, SURGE_25K_MAX]
    );

    const userIds = windowResult.rows.map(r => r.id);
    let awarded = 0;

    for (const userId of userIds) {
      const success = await awardBadge(fastify, userId, SURGE_25K_ID);
      if (success) awarded++;
    }

    return { totalInRange: userIds.length, awarded };
  } catch (err) {
    fastify.log.error({ err }, 'Error backfilling surge badges');
    throw err;
  }
}

export { FOUNDING_GENERAL_ID, FOUNDING_PRO_ID, FOUNDING_RECRUITER_ID, FOUNDING_CAPTAIN_ID, FOUNDING_CENTURION_ID, SURGE_25K_ID, FOUNDING_THRESHOLD, CENTURION_THRESHOLD };
