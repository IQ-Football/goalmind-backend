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
const ARES_SURGE_ID = '770e8400-e29b-41d4-a716-446655440002';
const ELITE_CENTURION_ID = '770e8400-e29b-41d4-a716-446655440003';
const TRIBE_COMMANDER_ID = '550e8400-e29b-41d4-a716-446655440005';
// Prestige pack achievement IDs (referenced by paymentsService.js — restored as
// part of the Konnect/prestige merge that shipped with missing constants)
const EKO_VANGUARD_ID = '550e8400-e29b-41d4-a716-446655440020';
const LEGACY_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440021';
const EGY_ZAM_PRESTIGE_ID = '550e8400-e29b-41d4-a716-446655440022';
const EGY_AHL_PRESTIGE_ID = '550e8400-e29b-41d4-a716-446655440023';
const TUN_EST_PRESTIGE_ID = '550e8400-e29b-41d4-a716-446655440024';
const TUN_CA_PRESTIGE_ID = '550e8400-e29b-41d4-a716-446655440025';
const FOUNDING_THRESHOLD = 10;
const CENTURION_THRESHOLD = 100;
const COMMANDER_THRESHOLD = 1000;
const SURGE_25K_MIN = 23388;
const SURGE_25K_MAX = 25000;

/**
 * Award a specific badge to a user
 */
export async function awardBadge(fastify, userId, achievementId) {
  return awardBadgeWithClient(fastify.db, userId, achievementId, fastify.log);
}

/**
 * Internal version that takes a DB client (useful for transactions)
 */
export async function awardBadgeWithClient(client, userId, achievementId, logger = console) {
  try {
    const result = await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING *`,
      [userId, achievementId]
    );

    if (result.rows.length > 0) {
      if (logger) logger.info({ userId, achievementId }, 'Achievement awarded');
      return true;
    }
    return false;
  } catch (err) {
    if (logger) logger.error({ err, userId, achievementId }, 'Error awarding achievement');
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
 * Get the user's join rank within their tribe
 */
async function getTribeJoinRank(client, userId, tribeId) {
  const rankResult = await client.query(
    `WITH tribe_ranks AS (
      SELECT u.id, ROW_NUMBER() OVER (ORDER BY tm.joined_at ASC NULLS LAST, u.created_at ASC) as rank
      FROM users u
      LEFT JOIN tribe_members tm ON u.id = tm.user_id
      WHERE u.tribe_id = $1
    )
    SELECT rank FROM tribe_ranks WHERE id = $2`,
    [tribeId, userId]
  );
  return rankResult.rows[0]?.rank;
}

/**
 * Award the Founding General badge manually with metadata updates
 */
export async function awardFoundingGeneral(fastify, userId, force = false, manualSignupNumber = null) {
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

    // --- Imperial Status Lock (Phase 4.2) ---
    // Only the 'Imperial Ten' tribes can award Founding General status during the surge.
    const imperialTenSlugs = [
      'al-ahly', 'wydad-casablanca', 'raja-casablanca', 'yanga-sc', 'enyimba-fc',
      'orlando-pirates', 'simba-sc', 'mamelodi-sundowns', 'kaizer-chiefs', 'zamalek-sc'
    ];
    const tribeSlugRes = await client.query('SELECT slug FROM tribes WHERE id = $1', [tribeId]);
    const tribeSlug = tribeSlugRes.rows[0]?.slug;

    if (!imperialTenSlugs.includes(tribeSlug) && !force) {
      await client.query('ROLLBACK');
      fastify.log.info({ tribeId, tribeSlug }, 'Tribe not in Imperial Ten, skipping Founding General');
      return { success: false, reason: 'tribe_not_imperial' };
    }

    // 1.5 Lock the tribe to ensure unique signup numbers for this tribe
    await client.query('SELECT id FROM tribes WHERE id = $1 FOR UPDATE', [tribeId]);

    // 1.6 Check if user already has the badge
    const existingBadge = await client.query(
      'SELECT earned_at FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [userId, FOUNDING_GENERAL_ID]
    );

    let signupNumber = manualSignupNumber;
    
    if (existingBadge.rows.length > 0 && !manualSignupNumber) {
      // User already has it, we check if they have a signup number in metadata
      const existingMetadata = await client.query(
        "SELECT metadata->'badges'->'founding_general'->>'signup_number' as num FROM users WHERE id = $1",
        [userId]
      );
      if (existingMetadata.rows[0]?.num) {
        signupNumber = parseInt(existingMetadata.rows[0].num);
        await client.query('ROLLBACK');
        return { success: false, reason: 'already_awarded', signupNumber };
      }
    }

    if (!signupNumber) {
      // 2. Determine signup number based on their registration rank in the tribe
      const userRank = await getTribeJoinRank(client, userId, tribeId);

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

    // 4.5 Induct into Hall of Generals (Historical Record)
    await client.query(
      'INSERT INTO hall_of_generals (user_id, tribe_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, tribeId, 'Founding General Status (Launch Phase)']
    );

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
      // Determine signup number based on their registration rank in the tribe
      const userRank = await getTribeJoinRank(client, userId, tribeId);

      if (!userRank) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'user_not_in_tribe_ranks' };
      }

      // Check range: Centurion is typically 11-100
      if (existingBadge.rows.length === 0 && !force && (userRank <= FOUNDING_THRESHOLD || userRank > CENTURION_THRESHOLD)) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'out_of_range', rank: userRank };
      }

      signupNumber = userRank;
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
 * Award the Tribe Commander badge to the tribe leader
 */
export async function awardTribeCommander(fastify, tribeId) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Find the leader (Founding Captain) for this tribe
    const leaderResult = await client.query(
      `SELECT u.id, u.username FROM users u
       JOIN user_achievements ua ON u.id = ua.user_id
       WHERE u.tribe_id = $1 AND ua.achievement_id = $2`,
      [tribeId, FOUNDING_CAPTAIN_ID]
    );

    if (leaderResult.rows.length === 0) {
      // Fallback: If no captain, pick the first member who joined
      const fallbackResult = await client.query(
        `SELECT u.id, u.username FROM users u
         JOIN tribe_members tm ON u.id = tm.user_id
         WHERE u.tribe_id = $1
         ORDER BY tm.joined_at ASC
         LIMIT 1`,
        [tribeId]
      );
      
      if (fallbackResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'no_leader_found' };
      }
      leaderResult.rows[0] = fallbackResult.rows[0];
    }

    const leaderId = leaderResult.rows[0].id;

    // 2. Award the badge
    await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [leaderId, TRIBE_COMMANDER_ID]
    );

    // 3. Update metadata
    const badgeData = {
      asset: '/assets/badges/tribe_commander.png',
      title: 'Imperial Commander',
      flair_name: 'Golden Crest'
    };

    await client.query(`
      UPDATE users
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(metadata->'badges', '{}'::jsonb) || jsonb_build_object('tribe_commander', $1::jsonb)),
          title = 'Imperial Commander'
      WHERE id = $2
    `, [JSON.stringify(badgeData), leaderId]);

    await client.query('COMMIT');
    fastify.log.info({ leaderId, tribeId }, 'Tribe Commander badge awarded to leader');
    
    return { success: true, leaderId };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, tribeId }, 'Error awarding Tribe Commander badge');
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
export async function checkAndAward25kSurgeBadge(fastify, userId) {
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

export { 
  FOUNDING_GENERAL_ID, 
  FOUNDING_PRO_ID, 
  FOUNDING_RECRUITER_ID, 
  FOUNDING_CAPTAIN_ID, 
  FOUNDING_CENTURION_ID, 
  SURGE_25K_ID, 
  ARES_SURGE_ID,
  ELITE_CENTURION_ID,
  TRIBE_COMMANDER_ID,
  EKO_VANGUARD_ID,
  LEGACY_GENERAL_ID,
  EGY_ZAM_PRESTIGE_ID,
  EGY_AHL_PRESTIGE_ID,
  TUN_EST_PRESTIGE_ID,
  TUN_CA_PRESTIGE_ID,
  FOUNDING_THRESHOLD, 
  CENTURION_THRESHOLD
};
