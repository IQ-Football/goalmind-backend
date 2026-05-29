
import { getActiveWars } from './tribeWarService.js';

/**
 * Get top 10 contributors for a tribe with their badges
 */
export async function getHallOfGenerals(fastify, tribeId) {
  try {
    const result = await fastify.db.query(
      `SELECT u.id, u.username, u.elo, tm.contribution_points
       FROM users u
       JOIN tribe_members tm ON u.id = tm.user_id
       WHERE tm.tribe_id = $1
       ORDER BY u.elo DESC
       LIMIT 10`,
      [tribeId]
    );

    const generals = result.rows;

    // Fetch badges for each general
    for (const general of generals) {
      const badgesResult = await fastify.db.query(
        `SELECT a.name, a.slug, a.badge_url
         FROM achievements a
         JOIN user_achievements ua ON a.id = ua.achievement_id
         WHERE ua.user_id = $1`,
        [general.id]
      );
      general.badges = badgesResult.rows;
    }

    return generals;
  } catch (err) {
    fastify.log.error('Error fetching Hall of Generals:', err);
    return [];
  }
}

/**
 * Get recent victories against rival tribes
 */
export async function getRecentVictories(fastify, tribeId) {
  try {
    // Get rival tribe IDs
    const tribeResult = await fastify.db.query(
      'SELECT rival_tribe_ids FROM tribes WHERE id = $1',
      [tribeId]
    );
    
    const rivalIds = tribeResult.rows[0]?.rival_tribe_ids || [];
    if (rivalIds.length === 0) return [];

    const result = await fastify.db.query(
      `SELECT b.id, b.winner_id, b.created_at,
              u_winner.username as winner_username,
              u_loser.username as loser_username,
              t_loser.name as loser_tribe_name,
              t_loser.slug as loser_tribe_slug
       FROM battles b
       JOIN users u_winner ON b.winner_id = u_winner.id
       JOIN users u_loser ON (b.player1_id = u_loser.id OR b.player2_id = u_loser.id) AND u_loser.id != b.winner_id
       JOIN tribes t_loser ON u_loser.tribe_id = t_loser.id
       WHERE u_winner.tribe_id = $1 AND u_loser.tribe_id = ANY($2)
       AND b.status = 'completed'
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [tribeId, rivalIds]
    );

    return result.rows.map(row => ({
      id: row.id,
      winnerUsername: row.winner_username,
      loserUsername: row.loser_username,
      loserTribeName: row.loser_tribe_name,
      loserTribeSlug: row.loser_tribe_slug,
      timestamp: row.created_at,
      message: `${row.winner_username} crushed ${row.loser_tribe_name} in a 1v1 Battle!`
    }));
  } catch (err) {
    fastify.log.error('Error fetching recent victories:', err);
    return [];
  }
}

/**
 * Get comprehensive War Room data for a tribe
 */
export async function getWarRoomData(fastify, slug) {
  // 1. Fetch basic tribe info
  const tribeResult = await fastify.db.query(
    'SELECT id, name, slug, motto, primary_color, secondary_color, banner_url, member_count, is_super_tribe FROM tribes WHERE slug = $1',
    [slug]
  );

  if (tribeResult.rows.length === 0) {
    throw new Error('TRIBE_NOT_FOUND');
  }

  const tribe = tribeResult.rows[0];

  // 2. Global Power Rank
  const tribeRank = await fastify.redis.zrevrank('leaderboard:tribal', tribe.id);
  const globalRank = tribeRank !== null ? tribeRank + 1 : null;

  // 3. Aggregate IQ
  const iqResult = await fastify.db.query(
    'SELECT SUM(COALESCE(elo, 0)) as aggregate_iq FROM users WHERE tribe_id = $1',
    [tribe.id]
  );
  const aggregateIq = parseInt(iqResult.rows[0].aggregate_iq || 0);

  // 4. Hall of Generals
  const hallOfGenerals = await getHallOfGenerals(fastify, tribe.id);

  // 5. Recent Victories
  const recentVictories = await getRecentVictories(fastify, tribe.id);

  // 6. Derby Windows (Active Tribe Wars)
  const activeWars = await getActiveWars(fastify);
  const derbyWindows = activeWars.filter(war => 
    war.tribe1Id === tribe.id || war.tribe2Id === tribe.id
  ).map(war => ({
    id: war.id,
    rivalTribeId: war.tribe1Id === tribe.id ? war.tribe2Id : war.tribe1Id,
    endTime: war.endTime,
    multiplier: war.multiplier
  }));

  // Resolve rival tribe names for derby windows
  for (const window of derbyWindows) {
    const rivalResult = await fastify.db.query('SELECT name, slug FROM tribes WHERE id = $1', [window.rivalTribeId]);
    window.rivalTribeName = rivalResult.rows[0]?.name;
    window.rivalTribeSlug = rivalResult.rows[0]?.slug;
  }

  return {
    tribe: {
      id: tribe.id,
      name: tribe.name,
      slug: tribe.slug,
      motto: tribe.motto,
      primaryColor: tribe.primary_color,
      secondaryColor: tribe.secondary_color,
      bannerUrl: tribe.banner_url,
      isSuperTribe: tribe.is_super_tribe,
      memberCount: tribe.member_count
    },
    rankings: {
      globalRank,
      aggregateIq
    },
    hallOfGenerals,
    battleFeed: {
      recentVictories,
      derbyWindows
    }
  };
}
