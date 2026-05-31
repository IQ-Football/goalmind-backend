import { hasAchievement, FOUNDING_CAPTAIN_ID, awardFoundingGeneral, awardFoundingCenturion, checkAndAwardSurgeBadge } from './achievementService.js';

/**
 * Fetch tribal visual configuration.
 */
export async function getTribeIdentity(fastify, tribeId) {
  const result = await fastify.db.query(
    `SELECT id, name, slug, logo_url, primary_color, secondary_color, banner_url, motto
     FROM tribes
     WHERE id = $1`,
    [tribeId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Update tribal identity.
 * Only Founding Captains or Admins allowed.
 */
export async function updateTribeIdentity(fastify, { tribeId, userId, motto, primaryColor, secondaryColor, bannerUrl }) {
  // 1. Validation Logic: Check if user is Admin or Founding Captain for this tribe
  const userResult = await fastify.db.query(
    `SELECT role, tribe_id FROM users WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = userResult.rows[0];
  const isAdmin = user.role === 'admin';

  if (!isAdmin) {
    // Check for Founding Captain achievement
    const isFoundingCaptain = await hasAchievement(fastify, userId, FOUNDING_CAPTAIN_ID);

    if (!isFoundingCaptain) {
      throw new Error('Unauthorized: Only Founding Captains or Admins can modify tribal identity');
    }

    // Also verify they belong to this tribe
    if (user.tribe_id !== tribeId) {
        throw new Error('Unauthorized: You can only modify your own tribe');
    }
  }

  // 2. Perform Update
  const updates = [];
  const params = [];
  let paramIdx = 1;

  if (motto !== undefined) {
    updates.push(`motto = $${paramIdx++}`);
    params.push(motto);
  }
  if (primaryColor !== undefined) {
    updates.push(`primary_color = $${paramIdx++}`);
    params.push(primaryColor);
  }
  if (secondaryColor !== undefined) {
    updates.push(`secondary_color = $${paramIdx++}`);
    params.push(secondaryColor);
  }
  if (bannerUrl !== undefined) {
    updates.push(`banner_url = $${paramIdx++}`);
    params.push(bannerUrl);
  }

  if (updates.length === 0) {
    return { success: true, message: 'No changes provided' };
  }

  params.push(tribeId);
  const query = `
    UPDATE tribes 
    SET ${updates.join(', ')}
    WHERE id = $${paramIdx}
    RETURNING *
  `;

  const result = await fastify.db.query(query, params);

  return {
    success: true,
    data: result.rows[0]
  };
}

/**
 * Process Tribal Catch-Up and Bounty logic for a new member.
 */
export async function processTribalCatchup(fastify, { userId, tribeId }) {
  try {
    const laggardSlugs = ['kaizer-chiefs', 'simba-sc', 'yanga-sc'];
    const tribeInfo = await fastify.db.query(
      'SELECT slug, member_count, zero_broken_at FROM tribes WHERE id = $1',
      [tribeId]
    ).then(r => r.rows[0]);

    if (!tribeInfo) return;

    // 1. Zero-Breaker Logic
    if (tribeInfo.member_count === 1) {
      await fastify.db.query(
        `UPDATE tribe_members 
         SET is_zero_breaker = true,
             metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{badges,zero_breaker}', '"/assets/badges/tribal_spark.png"'::jsonb)
         WHERE user_id = $1`,
        [userId]
      );
      await fastify.db.query(
        `UPDATE users SET title = 'Tribal Spark' WHERE id = $1`,
        [userId]
      );
      await fastify.db.query(
        `UPDATE tribes SET zero_broken_at = NOW() WHERE id = $1`,
        [tribeId]
      );
      fastify.log.info({ userId, tribeId }, 'Zero-Breaker awarded');
    }

    // 1.5 Founding General & Centurion Logic
    if (tribeInfo.member_count <= 10) {
      await awardFoundingGeneral(fastify, userId);
    } else if (tribeInfo.member_count <= 100) {
      await awardFoundingCenturion(fastify, userId);
    }

    // 1.6 Global Surge Badge Logic
    await checkAndAwardSurgeBadge(fastify, userId);

    // 2. Vanguard 100 Logic (Multiplier flag and Power Point Airdrop)
    if (laggardSlugs.includes(tribeInfo.slug) && tribeInfo.member_count <= 100) {
      await fastify.db.query(
        `UPDATE tribe_members 
         SET is_vanguard_100 = true,
             metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{badges,vanguard_100}', '"/assets/badges/founding_pro.png"'::jsonb)
         WHERE user_id = $1`,
        [userId]
      );
      // Airdrop +500 Power Points (Nation Points)
      await fastify.db.query(
        `UPDATE users SET nation_points = COALESCE(nation_points, 0) + 500 WHERE id = $1`,
        [userId]
      );
      fastify.log.info({ userId, tribeId }, 'Vanguard 100 rewards awarded');
    }

    // 3. Deadlock Breaker Badge logic (Check if 50th signup within 72h)
    if (tribeInfo.member_count === 50 && tribeInfo.zero_broken_at) {
      const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
      if (new Date(tribeInfo.zero_broken_at) > seventyTwoHoursAgo) {
        const badgeResult = await fastify.db.query(
          "SELECT id FROM achievements WHERE name = 'Deadlock Breaker'"
        );
        if (badgeResult.rows.length > 0) {
          const badgeId = badgeResult.rows[0].id;
          await fastify.db.query(
            `INSERT INTO user_achievements (user_id, achievement_id)
             SELECT user_id, $1 FROM tribe_members WHERE tribe_id = $2
             ON CONFLICT DO NOTHING`,
            [badgeId, tribeId]
          );
          fastify.log.info({ tribeId }, 'Deadlock Breaker badge awarded to all members');
        }
      }
    }
  } catch (err) {
    fastify.log.error({ err, userId, tribeId }, 'Error processing tribal catchup');
  }
}

export default {
  getTribeIdentity,
  updateTribeIdentity,
  processTribalCatchup
};
