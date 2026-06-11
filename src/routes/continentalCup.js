/**
 * Continental Cup Routes
 */
import { authenticate } from '../middleware/auth.js';
import {
  getActiveSeason,
  updateAllTpi,
  getCupLeaderboard,
  issueBountyChallenge,
  refreshActiveUserStats
} from '../services/continentalCupService.js';

const continentalCupRoutes = async (fastify, options) => {

  // GET /continental-cup/leaderboard — TPI Leaderboard
  fastify.get('/leaderboard', async (request, reply) => {
    try {
      const season = await getActiveSeason(fastify);
      if (!season) {
        return reply.send({ success: true, data: { leaderboard: [], message: 'No active Continental Cup season' } });
      }

      const leaderboard = await getCupLeaderboard(fastify, season.id);
      return reply.send({
        success: true,
        data: {
          season,
          leaderboard,
          updatedAt: new Date().toISOString()
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch leaderboard' } });
    }
  });

  // POST /continental-cup/admin/update-tpi — Admin: Force update TPI rankings
  fastify.post('/admin/update-tpi', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;

    // Check admin role
    const adminResult = await fastify.db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!adminResult.rows.length || adminResult.rows[0].role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }

    try {
      const season = await getActiveSeason(fastify);
      if (!season) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No active season to update' } });
      }

      await updateAllTpi(fastify, season.id);
      return reply.send({ success: true, message: 'TPI rankings updated successfully' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update TPI' } });
    }
  });

  // POST /continental-cup/bounty — Issue a Bounty Challenge
  fastify.post('/bounty', { preHandler: authenticate }, async (request, reply) => {
    const { challenged_id } = request.body;
    const challengerId = request.user.id;

    if (!challenged_id) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'challenged_id is required' } });
    }

    try {
      const bounty = await issueBountyChallenge(fastify, challengerId, challenged_id);
      return reply.status(201).send({ success: true, data: bounty });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ success: false, error: { code: 'BOUNTY_ERROR', message: err.message } });
    }
  });

  // GET /continental-cup/active-members/refresh — Refresh active user stats (Admin only)
  fastify.get('/admin/refresh-active-stats', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    const adminResult = await fastify.db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!adminResult.rows.length || adminResult.rows[0].role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }

    const success = await refreshActiveUserStats(fastify);
    return reply.send({ success });
  });
};

export default continentalCupRoutes;
