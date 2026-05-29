/**
 * League System Routes — Enhanced Endpoints + P&R Cron Jobs
 * 
 * Missing endpoints added:
 * - GET  /leagues/seasons/current           — Current season info
 * - GET  /leagues/:id/groups              — Group listing
 * - POST /leagues/leave                   — Leave league
 * - GET  /leagues/me/history             — User's league history
 * - POST /leagues/weekly-pr              — Manually trigger weekly P&R (admin)
 */

import { authenticate } from '../middleware/auth.js';
import {
  ensureLeagueTables,
  seed5TierLeagues,
  getOrCreateCurrentSeason,
  getLeagueForElo,
  awardLeaguePoints,
  processWeeklyPromotionRelegation,
  checkAndTransitionSeasons,
  joinLeague,
  leaveLeague,
  LEAGUE_TIERS,
} from '../services/leagueSystemService.js';

const leagueSystemRoutes = async (fastify, options) => {

  // ─── INIT ───────────────────────────────────────────────────────────────
  await ensureLeagueTables(fastify);
  await seed5TierLeagues(fastify);

  // ─── WEEKLY P&R CRON JOB ─────────────────────────────────────────────────
  // Process every Sunday at 23:59
  let lastProcessed = null;
  async function runWeeklyPR() {
    try {
      const results = await processWeeklyPromotionRelegation(fastify);
      lastProcessed = new Date().toISOString();
      fastify.log.info(`Weekly P&R complete: ${results.length} leagues processed`);
      return results;
    } catch (err) {
      fastify.log.error('Weekly P&R error:', err);
      return [];
    }
  }

  // ─── SEASON TRANSITION CRON ─────────────────────────────────────────────
  // Check every hour for season transitions
  async function runSeasonTransitions() {
    try {
      const results = await checkAndTransitionSeasons(fastify);
      if (results.length > 0) {
        fastify.log.info(`Season transitions: ${results.map(r => r.action).join(', ')}`);
      }
      return results;
    } catch (err) {
      fastify.log.error('Season transition error:', err);
      return [];
    }
  }

  // ─── GET /leagues/seasons/current ──────────────────────────────────────
  fastify.get('/seasons/current', { preHandler: authenticate }, async (request, reply) => {
    const { leagueId } = request.query;
    try {
      let leagues;
      if (leagueId) {
        const season = await getOrCreateCurrentSeason(fastify, leagueId);
        return reply.send({ success: true, data: season || null });
      }
      // All active leagues' current seasons
      const result = await fastify.db.query(
        `SELECT ls.*, l.name as league_name, l.slug, l.tier
         FROM league_seasons ls
         JOIN leagues l ON ls.league_id = l.id
         WHERE ls.status = 'active'
         ORDER BY l.tier ASC`
      );
      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch seasons' } });
    }
  });

  // ─── GET /leagues/:id/groups ───────────────────────────────────────────
  fastify.get('/:id/groups', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    try {
      const season = await getOrCreateCurrentSeason(fastify, id);
      if (!season) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No season found' } });
      }
      const groupsResult = await fastify.db.query(
        `SELECT lg.*, 
                (SELECT COUNT(*) FROM league_group_members WHERE group_id = lg.id) as member_count
         FROM league_groups lg
         WHERE lg.league_id = $1 AND lg.season_id = $2
         ORDER BY lg.group_number ASC`,
        [id, season.id]
      );
      return reply.send({ success: true, data: groupsResult.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch groups' } });
    }
  });

  // ─── GET /leagues/:id/participants ───────────────────────────────────
  fastify.get('/:id/participants', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const { limit = 50, offset = 0 } = request.query;
    try {
      const season = await getOrCreateCurrentSeason(fastify, id);
      if (!season) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No season found' } });
      }
      const result = await fastify.db.query(
        `SELECT lp.*, u.username, u.elo, u.tribe_id,
                t.name as tribe_name, t.slug as tribe_slug
         FROM league_participants lp
         JOIN users u ON lp.user_id = u.id
         LEFT JOIN tribes t ON u.tribe_id = t.id
         WHERE lp.league_id = $1 AND lp.season_id = $2
         ORDER BY lp.league_points DESC, u.elo DESC
         LIMIT $3 OFFSET $4`,
        [id, season.id, parseInt(limit), parseInt(offset)]
      );
      const total = await fastify.db.query(
        `SELECT COUNT(*) FROM league_participants WHERE league_id = $1 AND season_id = $2`,
        [id, season.id]
      );
      return reply.send({ success: true, data: { participants: result.rows, total: parseInt(total.rows[0].count) } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch participants' } });
    }
  });

  // ─── POST /leagues/leave ──────────────────────────────────────────────
  fastify.post('/leave', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    const { leagueId } = request.body || {};
    if (!leagueId) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'leagueId is required' } });
    }
    try {
      const result = await leaveLeague(fastify, userId, leagueId);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: { code: 'ERROR', message: result.error } });
      }
      return reply.send({ success: true, message: 'Left league successfully' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to leave league' } });
    }
  });

  // ─── POST /leagues/join/:leagueId ──────────────────────────────────────
  fastify.post('/join/:leagueId', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    const { leagueId } = request.params;
    try {
      const result = await joinLeague(fastify, userId, leagueId);
      if (result.alreadyInLeague) {
        return reply.status(409).send({ success: false, error: { code: 'ALREADY_JOINED', message: 'Already in this league' } });
      }
      return reply.status(201).send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to join league' } });
    }
  });

  // ─── GET /leagues/me/history ───────────────────────────────────────────
  fastify.get('/me/history', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    const { limit = 10 } = request.query;
    try {
      const result = await fastify.db.query(
        `SELECT lp.league_id, lp.season_id, lp.league_points, 
                lp.battles_played, lp.battles_won, lp.battles_drawn, lp.battles_lost,
                lp.rank, lp.is_promoted, lp.is_relegated, lp.current_elo,
                ls.season_number, ls.start_date, ls.end_date, ls.status as season_status,
                l.name as league_name, l.slug as league_slug, l.tier
         FROM league_participants lp
         JOIN leagues l ON lp.league_id = l.id
         LEFT JOIN league_seasons ls ON lp.season_id = ls.id
         WHERE lp.user_id = $1
         ORDER BY ls.start_date DESC NULLS LAST
         LIMIT $2`,
        [userId, parseInt(limit)]
      );
      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch history' } });
    }
  });

  // ─── GET /leagues/tiers ────────────────────────────────────────────────
  fastify.get('/tiers/info', async (request, reply) => {
    // Public endpoint - returns tier info for league selection UI
    return reply.send({ success: true, data: LEAGUE_TIERS });
  });

  // ─── POST /leagues/weekly-pr ───────────────────────────────────────────
  // Admin-only: manually trigger weekly P&R
  fastify.post('/weekly-pr', { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }
    try {
      const results = await runWeeklyPR();
      return reply.send({ success: true, data: { processed: results.length, results } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to run P&R' } });
    }
  });

  // ─── POST /leagues/season-transition ───────────────────────────────────
  fastify.post('/season-transition', { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }
    try {
      const results = await runSeasonTransitions();
      return reply.send({ success: true, data: results });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed' } });
    }
  });

  // ─── START BACKGROUND JOBS ────────────────────────────────────────────────
  // Season transition check every hour
  setInterval(() => {
    runSeasonTransitions().catch(err => fastify.log.error('Season transition error:', err));
  }, 3600000);

  fastify.log.info('League system routes registered + cron jobs scheduled');
}

export default leagueSystemRoutes;