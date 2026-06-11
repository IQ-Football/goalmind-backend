import { authenticate } from '../middleware/auth.js';
import { 
  areTribesRivals, 
  calculateTribePoints,
  getTribeWarScores,
  getDerbyHistory,
  getDerbyMultiplierValue,
  getConfiguredRivalries,
  getActiveWars,
  getRivalryAlerts,
  recordTribalBattle,
} from '../services/tribeWarScoring.js';
import { getTribeWarLeaderboard, getTribeRivalries } from '../services/tribeWarService.js';
import { getActiveDerbyWindows, getDerbyMultipliers } from '../services/derbyService.js';

const tribeWarRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /tribe-wars/derby-windows - Get active derby windows and multipliers
  fastify.get('/derby-windows', async (request, reply) => {
    try {
      const userId = request.user.id;
      const userResult = await fastify.db.query('SELECT tribe_id FROM users WHERE id = $1', [userId]);
      const tribeId = userResult.rows[0]?.tribe_id;

      const activeWindows = await getActiveDerbyWindows(fastify, tribeId);
      const multipliers = await getDerbyMultipliers(fastify, tribeId);

      return reply.send({
        success: true,
        data: {
          activeWindows,
          multipliers,
          tribeId
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch derby windows',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribe-wars/leaderboard - Rivalry battles won leaderboard
  fastify.get('/leaderboard', async (request, reply) => {
    const { limit = 50 } = request.query;

    try {
      const leaderboard = await getTribeWarLeaderboard(fastify, parseInt(limit));

      return reply.send({
        success: true,
        data: {
          leaderboard,
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tribe war leaderboard',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribe-wars/active - Get active tribe war events
  fastify.get('/active', async (request, reply) => {
    try {
      const activeWars = await getActiveWars(fastify);

      return reply.send({
        success: true,
        data: {
          activeWars,
          count: activeWars.length,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch active tribe wars',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribe-wars/scores - Get tribe war scoring aggregates
  fastify.get('/scores', async (request, reply) => {
    const { timeWindow = 24 } = request.query;

    try {
      const scores = await getTribeWarScores(fastify, parseInt(timeWindow));

      return reply.send({
        success: true,
        data: {
          scores,
          timeWindowHours: parseInt(timeWindow),
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tribe war scores',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribe-wars/alerts - Get rivalry alerts for user's tribe
  fastify.get('/alerts', async (request, reply) => {
    try {
      const userId = request.user.id;
      
      const userResult = await fastify.db.query(
        'SELECT tribe_id FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0 || !userResult.rows[0].tribe_id) {
        return reply.send({
          success: true,
          data: { alerts: [], message: 'User not part of any tribe' },
          meta: { timestamp: new Date().toISOString(), requestId: request.id },
        });
      }
      
      const tribeId = userResult.rows[0].tribe_id;
      const alerts = await getRivalryAlerts(fastify, tribeId);

      return reply.send({
        success: true,
        data: { alerts, count: alerts.length },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rivalry alerts', requestId: request.id },
      });
    }
  });

  // GET /tribe-wars/derby/:tribe1/:tribe2 - Get derby history between two tribes
  fastify.get('/derby/:tribe1Slug/:tribe2Slug', async (request, reply) => {
    const { tribe1Slug, tribe2Slug } = request.params;

    try {
      const derbyHistory = await getDerbyHistory(fastify, tribe1Slug, tribe2Slug);

      if (derbyHistory.error) {
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: derbyHistory.error, requestId: request.id },
        });
      }

      return reply.send({
        success: true,
        data: derbyHistory,
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch derby history', requestId: request.id },
      });
    }
  });

  // GET /tribe-wars/config - Get rivalry configuration
  fastify.get('/config', async (request, reply) => {
    try {
      return reply.send({
        success: true,
        data: {
          rivalries: getConfiguredRivalries(),
          derbyMultiplier: getDerbyMultiplierValue(),
        },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rivalry config', requestId: request.id },
      });
    }
  });

  // GET /tribes/:id/rivalries - Get tribe's rivalries
  fastify.get('/tribes/:id/rivalries', async (request, reply) => {
    const { id } = request.params;

    try {
      const rivalries = await getTribeRivalries(fastify, id);

      if (!rivalries) {
        return reply.status(404).send({
          success: false,
          error: { code: 'TRIBE_NOT_FOUND', message: 'Tribe not found', requestId: request.id },
        });
      }

      return reply.send({
        success: true,
        data: rivalries,
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rivalries', requestId: request.id },
      });
    }
  });

  // POST /tribes/:id/rivalries - Set up rivalries for a tribe (admin)
  fastify.post('/tribes/:id/rivalries', async (request, reply) => {
    const { id } = request.params;
    const { rivalTribeIds } = request.body;

    if (!rivalTribeIds || !Array.isArray(rivalTribeIds)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'rivalTribeIds must be an array of tribe IDs', requestId: request.id },
      });
    }

    try {
      await fastify.db.query('UPDATE tribes SET rival_tribe_ids = $1 WHERE id = $2', [rivalTribeIds, id]);

      return reply.send({
        success: true,
        data: { tribeId: id, rivalTribeIds, updatedAt: new Date().toISOString() },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update rivalries', requestId: request.id },
      });
    }
  });
};

export default tribeWarRoutes;