import { authenticate, checkAdmin } from '../middleware/auth.js';
import {
  getNationalTribes,
  getUserNationalTribe,
  selectNationalTribe,
  getWC2026Matches,
  getActiveWCMatches,
  submitPrediction,
  getUserPredictions,
  getWC2026UserStats,
  enterKnockoutBracket,
  getUserKnockoutStatus,
  getActiveVAREevents,
  createVAREvent,
  enterVARBattle,
  activateMatch,
  awardChampionRewards,
} from '../services/wc2026Service.js';

const wc2026Routes = async (fastify, options) => {
  fastify.addHook('preHandler', authenticate);

  // GET /wc2026/nations — All national tribes
  fastify.get('/nations', async (request, reply) => {
    try {
      const nations = await getNationalTribes(fastify);
      return reply.send({
        success: true,
        data: { nations },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch nations', requestId: request.id },
      });
    }
  });

  // GET /wc2026/my-nation — User's selected national tribe
  fastify.get('/my-nation', async (request, reply) => {
    try {
      const nation = await getUserNationalTribe(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { nation },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch nation', requestId: request.id },
      });
    }
  });

  // POST /wc2026/my-nation — Select/replace national tribe
  fastify.post('/my-nation', async (request, reply) => {
    const { nation_id } = request.body;
    if (!nation_id) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'nation_id is required', requestId: request.id },
      });
    }

    const result = await selectNationalTribe(fastify, request.user.id, nation_id);
    if (!result.success) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Nation not found', requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: { message: 'National tribe selected', nation_id },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // GET /wc2026/matches — All WC 2026 matches
  fastify.get('/matches', async (request, reply) => {
    try {
      const { stage } = request.query;
      const matches = await getWC2026Matches(fastify, stage);
      return reply.send({
        success: true,
        data: { matches },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch matches', requestId: request.id },
      });
    }
  });

  // GET /wc2026/matches/live — Active/live matches
  fastify.get('/matches/live', async (request, reply) => {
    try {
      const matches = await getActiveWCMatches(fastify);
      return reply.send({
        success: true,
        data: { matches },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch live matches', requestId: request.id },
      });
    }
  });

  // POST /wc2026/predictions — Submit a prediction
  fastify.post('/predictions', async (request, reply) => {
    const { match_id, predicted_winner, predicted_team1_score, predicted_team2_score, predicted_first_scorer } = request.body;
    if (!match_id || !predicted_winner) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'match_id and predicted_winner are required', requestId: request.id },
      });
    }

    const result = await submitPrediction(fastify, request.user.id, match_id, {
      predicted_winner,
      predicted_team1_score,
      predicted_team2_score,
      predicted_first_scorer,
    });

    return reply.send({
      success: true,
      data: { message: 'Prediction submitted', match_id },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // GET /wc2026/predictions — User's predictions
  fastify.get('/predictions', async (request, reply) => {
    try {
      const predictions = await getUserPredictions(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { predictions },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch predictions', requestId: request.id },
      });
    }
  });

  // GET /wc2026/var — Active VAR events
  fastify.get('/var', async (request, reply) => {
    try {
      const { match_id } = request.query;
      const events = await getActiveVAREevents(fastify, match_id);
      return reply.send({
        success: true,
        data: { var_events: events },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch VAR events', requestId: request.id },
      });
    }
  });

  // POST /wc2026/var/:id/enter — Enter a VAR battle
  fastify.post('/var/:id/enter', async (request, reply) => {
    const { id } = request.params;
    const result = await enterVARBattle(fastify, request.user.id, id);
    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to enter VAR battle', requestId: request.id },
      });
    }
    return reply.send({
      success: true,
      data: { message: 'Entered VAR battle', var_event_id: id },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // GET /wc2026/stats — User's WC 2026 stats
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await getWC2026UserStats(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { stats },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats', requestId: request.id },
      });
    }
  });

  // POST /wc2026/knockout/:bracketId/enter — Enter knockout bracket
  fastify.post('/knockout/:bracketId/enter', async (request, reply) => {
    const { bracketId } = request.params;
    const result = await enterKnockoutBracket(fastify, request.user.id, bracketId);
    return reply.send({
      success: true,
      data: { message: 'Entered knockout bracket', bracket_id: bracketId },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // GET /wc2026/knockout/:bracketId — User's knockout status
  fastify.get('/knockout/:bracketId', async (request, reply) => {
    const { bracketId } = request.params;
    const status = await getUserKnockoutStatus(fastify, request.user.id, bracketId);
    return reply.send({
      success: true,
      data: { knockout: status },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ---- Admin-only endpoints ----

  // POST /wc2026/admin/var — Create a VAR event (admin/external feed)
  fastify.post('/admin/var', { preHandler: [authenticate, checkAdmin] }, async (request, reply) => {
    const { match_id, var_type, description, event_minute } = request.body;
    if (!match_id || !var_type) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'match_id and var_type required', requestId: request.id },
      });
    }
    const result = await createVAREvent(fastify, match_id, var_type, description, event_minute);
    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create VAR event', requestId: request.id },
      });
    }
    // Broadcast via Socket.IO
    const io = fastify.io;
    if (io) {
      io.of('/wc2026').emit('var:new', result.event);
    }
    return reply.send({
      success: true,
      data: { var_event: result.event },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // POST /wc2026/admin/match/:id/activate — Set match as active
  fastify.post('/admin/match/:id/activate', { preHandler: [authenticate, checkAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const result = await activateMatch(fastify, id);
    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to activate match', requestId: request.id },
      });
    }
    const io = fastify.io;
    if (io) {
      io.of('/wc2026').emit('match:activated', { match_id: id });
    }
    return reply.send({
      success: true,
      data: { message: 'Match activated', match_id: id },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // POST /wc2026/admin/champion/:nationId/award — Award champion rewards
  fastify.post('/admin/champion/:nationId/award', { preHandler: [authenticate, checkAdmin] }, async (request, reply) => {
    const { nationId } = request.params;
    const result = await awardChampionRewards(fastify, nationId);
    if (!result.success) {
      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_AWARDED', message: 'Champion rewards already distributed', requestId: request.id },
      });
    }
    const io = fastify.io;
    if (io) {
      io.of('/wc2026').emit('champion:awarded', { nation_id: nationId });
    }
    return reply.send({
      success: true,
      data: { message: 'Champion rewards awarded', nation_id: nationId },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
};

export default wc2026Routes;
