
import { recordTribalBattle } from './tribeWarScoring.js';

/**
 * Tournament Leaderboard Service
 * 
 * Handles real-time tribal rankings for the 5v5 Relay Tournament.
 */

export async function getTournamentRankings(fastify) {
  try {
    const result = await fastify.db.query(`
      SELECT 
        t.id, 
        t.name, 
        t.slug, 
        t.logo_url,
        t.primary_color,
        t.secondary_color,
        COUNT(rm.id) FILTER (WHERE rm.winner_tribe_id = t.id) as wins,
        COALESCE(SUM(
          CASE 
            WHEN rm.tribe_a_id = t.id THEN rm.tribe_a_score 
            ELSE rm.tribe_b_score 
          END * (CASE WHEN t.is_national_tribe = true THEN 2.0 ELSE 1.0 END)
        ), 0) as total_score,
        COUNT(rm.id) as matches_played
      FROM tribes t
      LEFT JOIN relay_matches rm ON (rm.tribe_a_id = t.id OR rm.tribe_b_id = t.id) AND rm.status = 'completed'
      WHERE t.is_super_tribe = true
      GROUP BY t.id
      ORDER BY wins DESC, total_score DESC, t.name ASC
    `);

    return result.rows.map((row, index) => ({
      rank: index + 1,
      tribeId: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logo_url,
      colors: {
        primary: row.primary_color,
        secondary: row.secondary_color
      },
      stats: {
        wins: parseInt(row.wins),
        totalScore: parseFloat(row.total_score),
        matchesPlayed: parseInt(row.matches_played)
      }
    }));
  } catch (err) {
    fastify.log.error('Error fetching tournament rankings:', err);
    return [];
  }
}

/**
 * Broadcast tournament leaderboard update to all connected clients
 */
export async function broadcastTournamentUpdate(fastify, tournamentNamespace) {
  try {
    const rankings = await getTournamentRankings(fastify);
    tournamentNamespace.emit('tournament:leaderboard_update', {
      rankings,
      updatedAt: new Date().toISOString()
    });
    
    // Also update Redis cache for REST API consistency
    await fastify.redis.set('cache:tournament:leaderboard', JSON.stringify(rankings), 'EX', 300);
    
    return true;
  } catch (err) {
    fastify.log.error('Error broadcasting tournament update:', err);
    return false;
  }
}

/**
 * Initialize tournament namespace and handlers
 */
export function setupTournamentHandlers(tournamentNamespace, fastify) {
  tournamentNamespace.on('connection', async (socket) => {
    fastify.log.info(`Tournament client connected: ${socket.id}`);
    
    // Send current rankings immediately on connection
    const rankings = await getTournamentRankings(fastify);
    socket.emit('tournament:leaderboard_update', {
      rankings,
      updatedAt: new Date().toISOString()
    });
    
    socket.on('disconnect', () => {
      fastify.log.info(`Tournament client disconnected: ${socket.id}`);
    });
  });
}
