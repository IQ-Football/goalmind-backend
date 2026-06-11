import { v4 as uuidv4 } from 'uuid';

/**
 * Continental Cup Service
 * 
 * TPI = (Total_Wins / Active_Members) * (Avg_IQ / 2000) * market_multiplier
 */

const WEIGHT_AVG_IQ_NORMALIZER = 2000;
const BOUNTY_REWARD_TOKENS = 250;
const BOUNTY_POINTS_MULTIPLIER = 5;

/**
 * Get the current active season
 */
export async function getActiveSeason(fastify) {
  const now = new Date();
  const res = await fastify.db.query(
    'SELECT * FROM continental_cup_seasons WHERE status = $1 AND start_at <= $2 AND end_at >= $2',
    ['active', now]
  );
  
  if (res.rows.length > 0) {
    return res.rows[0];
  }
  
  return null;
}

/**
 * Refresh the Active User Stats Materialized View
 * Should be called periodically or before TPI updates
 */
export async function refreshActiveUserStats(fastify) {
  try {
    await fastify.db.query('REFRESH MATERIALIZED VIEW active_user_stats');
    return true;
  } catch (err) {
    fastify.log.error('Error refreshing active_user_stats view:', err);
    return false;
  }
}

/**
 * Calculate TPI for all tribes in the current season
 * Optimized with batch queries and Materialized Views
 */
export async function updateAllTpi(fastify, seasonId) {
  const seasonRes = await fastify.db.query('SELECT * FROM continental_cup_seasons WHERE id = $1', [seasonId]);
  if (seasonRes.rows.length === 0) return;
  const season = seasonRes.rows[0];

  // 1. Refresh active user stats for accuracy
  await refreshActiveUserStats(fastify);

  // 2. Calculate Market Multipliers per region/market dynamically
  // Multiplier = Global_Avg_Market_Size / This_Market_Size
  // market_size = total waitlist signups in that region
  const marketStatsRes = await fastify.db.query(`
    SELECT 
      region as market, 
      SUM(waitlist_signups) as market_signups
    FROM tribes 
    WHERE is_super_tribe = true
    GROUP BY region
  `);
  
  const totalSuperTribeSignups = marketStatsRes.rows.reduce((acc, row) => acc + parseInt(row.market_signups || 0), 0);
  const avgMarketSignups = totalSuperTribeSignups / (marketStatsRes.rows.length || 1);
  
  const marketMultipliers = {};
  marketStatsRes.rows.forEach(row => {
    const signups = parseInt(row.market_signups) || 1;
    marketMultipliers[row.market] = avgMarketSignups / signups;
  });

  // 3. Fetch all tribe stats in one batch query
  // Uses active_user_stats materialized view for performance
  // Calculates Power Points: Base Wins + Surge Bonus + Bounty Bonus
  const tribeStatsRes = await fastify.db.query(`
    WITH tribe_base_stats AS (
        SELECT 
            b.winner_tribe_id,
            SUM(CASE WHEN s.id IS NOT NULL THEN 2 ELSE 1 END) as power_points
        FROM battles b
        LEFT JOIN derby_surge_windows s ON b.ended_at >= s.start_at AND b.ended_at <= s.end_at
        WHERE b.ended_at >= $1 AND b.ended_at <= $2 AND b.status = 'completed'
        GROUP BY b.winner_tribe_id
    ),
    bounty_stats AS (
        SELECT 
            u.tribe_id,
            SUM(bc.points_awarded - 1) as bounty_bonus
        FROM bounty_challenges bc
        JOIN users u ON bc.winner_id = u.id
        WHERE bc.status = 'completed' 
          AND bc.completed_at >= $1 
          AND bc.completed_at <= $2
        GROUP BY u.tribe_id
    )
    SELECT 
        t.id as tribe_id,
        t.avg_fan_iq,
        t.region,
        COALESCE(bs.power_points, 0) + COALESCE(bc.bounty_bonus, 0) as total_wins,
        COALESCE(a.active_count, 0) as active_members
    FROM tribes t
    LEFT JOIN tribe_base_stats bs ON bs.winner_tribe_id = t.id
    LEFT JOIN bounty_stats bc ON bc.tribe_id = t.id
    LEFT JOIN (
        SELECT tribe_id, COUNT(*) as active_count
        FROM active_user_stats
        GROUP BY tribe_id
    ) a ON a.tribe_id = t.id
    WHERE t.is_super_tribe = true;
  `, [season.start_at, season.end_at]);

  // 4. Update rankings
  for (const row of tribeStatsRes.rows) {
    const totalWins = parseInt(row.total_wins);
    const activeMembersCount = parseInt(row.active_members);
    const avgIq = parseFloat(row.avg_fan_iq) || 1000;
    const marketMultiplier = marketMultipliers[row.region] || 1.0;

    // TPI = (Total_Wins / Active_Members) * (Avg_IQ / 2000) * market_multiplier
    const tpi = (activeMembersCount > 0) 
      ? (totalWins / activeMembersCount) * (avgIq / WEIGHT_AVG_IQ_NORMALIZER) * marketMultiplier
      : 0;

    await fastify.db.query(
      `INSERT INTO continental_cup_tribe_rankings 
       (id, season_id, tribe_id, total_wins, active_members, avg_iq, market_multiplier, tpi, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (season_id, tribe_id) 
       DO UPDATE SET 
         total_wins = EXCLUDED.total_wins,
         active_members = EXCLUDED.active_members,
         avg_iq = EXCLUDED.avg_iq,
         market_multiplier = EXCLUDED.market_multiplier,
         tpi = EXCLUDED.tpi,
         updated_at = NOW()`,
      [uuidv4(), seasonId, row.tribe_id, totalWins, activeMembersCount, avgIq, marketMultiplier, tpi]
    );
  }
}

/**
 * Issue a Bounty Challenge between two Generals
 */
export async function issueBountyChallenge(fastify, challengerId, challengedId) {
  const season = await getActiveSeason(fastify);
  if (!season) throw new Error('No active Continental Cup season');

  // Verify both are Generals (Elo >= 2400 or has General badge)
  const generalsRes = await fastify.db.query(
    'SELECT id FROM users WHERE id IN ($1, $2) AND elo >= 2400',
    [challengerId, challengedId]
  );
  
  if (generalsRes.rows.length < 2) {
    // Check for "General" badge if Elo is low (honorary generals)
    const badgeRes = await fastify.db.query(
      `SELECT user_id FROM user_badges 
       WHERE user_id IN ($1, $2) 
       AND badge_id = (SELECT id FROM badges WHERE name = 'General' LIMIT 1)`,
      [challengerId, challengedId]
    );
    
    const generalIds = new Set([
      ...generalsRes.rows.map(r => r.id),
      ...badgeRes.rows.map(r => r.user_id)
    ]);
    
    if (generalIds.size < 2) {
      throw new Error('Both players must be Generals to issue Bounty Challenges');
    }
  }

  const res = await fastify.db.query(
    `INSERT INTO bounty_challenges (id, season_id, challenger_id, challenged_id, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING *`,
    [uuidv4(), season.id, challengerId, challengedId]
  );
  
  return res.rows[0];
}

/**
 * Get Continental Cup Leaderboard
 */
export async function getCupLeaderboard(fastify, seasonId) {
  const res = await fastify.db.query(
    `SELECT r.*, t.name as tribe_name, t.slug as tribe_slug, t.logo_url, t.region
     FROM continental_cup_tribe_rankings r
     JOIN tribes t ON t.id = r.tribe_id
     WHERE r.season_id = $1
     ORDER BY r.tpi DESC`,
    [seasonId]
  );
  return res.rows;
}

/**
 * Check if a battle was a bounty challenge and process rewards
 */
export async function checkAndProcessBounty(fastify, battleId, winnerId) {
  const bountyRes = await fastify.db.query(
    'SELECT * FROM bounty_challenges WHERE battle_id = $1 AND status = \'accepted\'',
    [battleId]
  );
  
  if (bountyRes.rows.length === 0) return null;
  
  const bounty = bountyRes.rows[0];
  
  await fastify.db.query(
    `UPDATE bounty_challenges 
     SET status = 'completed', winner_id = $1, points_awarded = $2, completed_at = NOW()
     WHERE id = $3`,
    [winnerId, BOUNTY_POINTS_MULTIPLIER, bounty.id]
  );
  
  if (winnerId) {
    // Award 250 GoalTokens to the winner
    await fastify.db.query(
      'UPDATE users SET gems = COALESCE(gems, 0) + $1 WHERE id = $2',
      [BOUNTY_REWARD_TOKENS, winnerId]
    );
  }
  
  return {
    isBounty: true,
    rewardTokens: BOUNTY_REWARD_TOKENS,
    pointsMultiplier: BOUNTY_POINTS_MULTIPLIER
  };
}

export default {
  getActiveSeason,
  updateAllTpi,
  issueBountyChallenge,
  getCupLeaderboard,
  checkAndProcessBounty,
  refreshActiveUserStats
};
