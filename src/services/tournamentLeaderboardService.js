import config from '../config.js';
import { getNationPointsMultiplier } from './surgeService.js';

/**
 * Tournament Leaderboard Service
 * 
 * Provides optimized PostgreSQL queries for real-time tribal rankings.
 * Handles WebSocket broadcasts for rank changes.
 */

const TOURNAMENT_START_DATE = '2026-05-11T00:00:00Z';

/**
 * Get the current tournament leaderboard
 * Optimized query using the new winner_tribe_id columns and relay_matches table.
 */
export async function getTournamentLeaderboard(fastify) {
  const query = `
    WITH battle_stats AS (
      SELECT 
        winner_tribe_id as tribe_id,
        COUNT(*) as battle_wins,
        SUM(tribe_points_awarded) as battle_points
      FROM battles
      WHERE status = 'completed' AND ended_at >= $1
      GROUP BY winner_tribe_id
    ),
    relay_stats AS (
      SELECT 
        winner_tribe_id as tribe_id,
        COUNT(*) as relay_wins,
        SUM(CASE WHEN winner_tribe_id = tribe_a_id THEN tribe_a_score ELSE tribe_b_score END) as relay_score
      FROM relay_matches
      WHERE status = 'completed' AND created_at >= $1 AND winner_tribe_id IS NOT NULL
      GROUP BY winner_tribe_id
    )
    SELECT 
      t.id, 
      t.name, 
      t.slug, 
      t.logo_url,
      t.primary_color,
      t.secondary_color,
      COALESCE(b.battle_wins, 0) as battle_wins,
      COALESCE(b.battle_points, 0) as battle_points,
      COALESCE(r.relay_wins, 0) as relay_wins,
      COALESCE(r.relay_score, 0) as relay_score,
      -- Tournament Formula: (Relay Wins * 500) + (Battle Wins * 10) + (Relay Score * 0.1)
      (COALESCE(r.relay_wins, 0) * 500 + COALESCE(b.battle_wins, 0) * 10 + COALESCE(r.relay_score, 0) * 0.1) as tournament_score
    FROM tribes t
    LEFT JOIN battle_stats b ON t.id = b.tribe_id
    LEFT JOIN relay_stats r ON t.id = r.tribe_id
    WHERE t.is_super_tribe = true OR t.is_national_tribe = true
    ORDER BY tournament_score DESC, relay_wins DESC, battle_wins DESC
    LIMIT 20
  `;

  const result = await fastify.db.query(query, [TOURNAMENT_START_DATE]);
  return result.rows.map((row, idx) => ({
    rank: idx + 1,
    ...row,
    tournament_score: Math.floor(row.tournament_score)
  }));
}

/**
 * Broadcast tournament events and rank changes
 */
export async function broadcastTournamentUpdate(fastify, eventData) {
  if (!fastify.io) return;

  const tournamentNamespace = fastify.io.of('/tournament');
  
  // 1. Fetch fresh leaderboard
  const leaderboard = await getTournamentLeaderboard(fastify);
  
  // 2. Apply Nation Points Multiplier for the "Real-Time Stream" if applicable
  // eventData might contain { type: 'battle_end', tribeId, points, tribeSlug }
  if (eventData && eventData.tribeSlug) {
    const multiplier = getNationPointsMultiplier(eventData.tribeSlug);
    eventData.multiplierApplied = multiplier;
    if (multiplier > 1) {
      eventData.bonusPoints = Math.round(eventData.points * (multiplier - 1));
    }
  }

  // 3. Broadcast the event and the updated leaderboard
  tournamentNamespace.emit('tournament:update', {
    event: eventData,
    leaderboard,
    timestamp: new Date().toISOString()
  });
}

/**
 * Setup WebSocket handlers for the tournament namespace
 */
export function setupTournamentHandlers(tournamentNamespace, fastify) {
  tournamentNamespace.on('connection', async (socket) => {
    fastify.log.info(`Tournament client connected: \${socket.id}`);
    
    // Send initial leaderboard on connection
    try {
      const leaderboard = await getTournamentLeaderboard(fastify);
      socket.emit('tournament:welcome', { leaderboard });
    } catch (err) {
      fastify.log.error('Error sending initial tournament leaderboard:', err);
    }
    
    socket.on('disconnect', () => {
      fastify.log.info(`Tournament client disconnected: \${socket.id}`);
    });
  });
}

export default {
  getTournamentLeaderboard,
  broadcastTournamentUpdate,
  setupTournamentHandlers
};
