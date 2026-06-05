import { v4 as uuidv4 } from 'uuid';

/**
 * Continental Cup Service
 */

const WEIGHT_AVG_IQ_NORMALIZER = 2000;
const BOUNTY_REWARD_TOKENS = 250;
const BOUNTY_POINTS_MULTIPLIER = 5;

/**
 * Get or create the current active season
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
  
  // No active season, check for upcoming
  const upcomingRes = await fastify.db.query(
    'SELECT * FROM continental_cup_seasons WHERE status = $1 ORDER BY start_at ASC LIMIT 1',
    ['upcoming']
  );
  
  if (upcomingRes.rows.length > 0 && upcomingRes.rows[0].start_at <= now) {
    // Activate it
    const season = upcomingRes.rows[0];
    await fastify.db.query(
      'UPDATE continental_cup_seasons SET status = $1 WHERE id = $2',
      ['active', season.id]
    );
    season.status = 'active';
    return season;
  }
  
  return null;
}

/**
 * Calculate TPI for all tribes in the current season
 */
export async function updateAllTpi(fastify, seasonId) {
  const seasonRes = await fastify.db.query('SELECT * FROM continental_cup_seasons WHERE id = $1', [seasonId]);
  if (seasonRes.rows.length === 0) return;
  const season = seasonRes.rows[0];

  // Get all tribes
  const tribesRes = await fastify.db.query('SELECT id, member_count, avg_fan_iq FROM tribes');
  
  for (const tribe of tribesRes.rows) {
    // 1. Total Wins in window
    const winsRes = await fastify.db.query(
      'SELECT COUNT(*) as wins FROM battles WHERE winner_tribe_id = $1 AND ended_at >= $2 AND ended_at <= $3',
      [tribe.id, season.start_at, season.end_at]
    );
    const totalWins = parseInt(winsRes.rows[0].wins) || 0;

    // 2. Active Members (>= 5 battles in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeRes = await fastify.db.query(
      `SELECT COUNT(DISTINCT user_id) as active_count 
       FROM (
         SELECT player1_id as user_id FROM battles WHERE (winner_tribe_id = $1 OR loser_tribe_id = $1) AND created_at >= $2
         UNION
         SELECT player2_id as user_id FROM battles WHERE (winner_tribe_id = $1 OR loser_tribe_id = $1) AND created_at >= $2
       ) sub
       JOIN battles b ON (b.player1_id = sub.user_id OR b.player2_id = sub.user_id)
       WHERE b.created_at >= $2
       GROUP BY sub.user_id
       HAVING COUNT(b.id) >= 5`,
      [tribe.id, sevenDaysAgo]
    );
    // Actually the above query is a bit slow. Let's simplify.
    const activeMembersCount = activeRes.rows.length;

    // 3. Market Multiplier (normalization)
    // Larger tribes have lower multiplier
    const marketMultiplier = Math.max(0.1, 1000 / Math.max(100, tribe.member_count || 100));

    // 4. Avg IQ
    const avgIq = parseFloat(tribe.avg_fan_iq) || 1000;

    // TPI = (Total_Wins / Active_Members) * (Avg_IQ / 2000) * market_multiplier
    const tpi = (activeMembersCount > 0) 
      ? (totalWins / activeMembersCount) * (avgIq / WEIGHT_AVG_IQ_NORMALIZER) * marketMultiplier
      : 0;

    await fastify.db.query(
      `INSERT INTO continental_cup_tribe_rankings 
       (season_id, tribe_id, total_wins, active_members, avg_iq, market_multiplier, tpi, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (season_id, tribe_id) 
       DO UPDATE SET 
         total_wins = EXCLUDED.total_wins,
         active_members = EXCLUDED.active_members,
         avg_iq = EXCLUDED.avg_iq,
         market_multiplier = EXCLUDED.market_multiplier,
         tpi = EXCLUDED.tpi,
         updated_at = NOW()`,
      [seasonId, tribe.id, totalWins, activeMembersCount, avgIq, marketMultiplier, tpi]
    );
  }
}

/**
 * Issue a Bounty Challenge
 */
export async function issueBountyChallenge(fastify, challengerId, challengedId) {
  const season = await getActiveSeason(fastify);
  if (!season) throw new Error('No active Continental Cup season');

  // Verify both are Generals
  const generalsRes = await fastify.db.query(
    'SELECT user_id FROM hall_of_generals WHERE user_id IN ($1, $2)',
    [challengerId, challengedId]
  );
  if (generalsRes.rows.length < 2) throw new Error('Both players must be Generals to issue Bounty Challenges');

  const res = await fastify.db.query(
    `INSERT INTO bounty_challenges (season_id, challenger_id, challenged_id, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING *`,
    [season.id, challengerId, challengedId]
  );
  
  return res.rows[0];
}

/**
 * Get Continental Cup Leaderboard
 */
export async function getCupLeaderboard(fastify, seasonId) {
  const res = await fastify.db.query(
    `SELECT r.*, t.name as tribe_name, t.slug as tribe_slug, t.logo_url
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
  checkAndProcessBounty
};
