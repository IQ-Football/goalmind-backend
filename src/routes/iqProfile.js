/**
 * IQ Profile Routes — "Football IQ Identity Card"
 * 
 * Endpoints:
 * GET  /me/iq-profile  — Full IQ profile (identity card data)
 * POST /me/iq-profile/refresh — Force recompute profile
 */

import { authenticate } from '../middleware/auth.js';
import {
  getIQProfile,
  computeIQProfile,
  ensureIQProfileTable,
  runDailyPercentileJob,
  awardCategoryBadges,
} from '../services/iqStatusService.js';

const iqProfileRoutes = async (fastify, options) => {

  // Ensure table on startup
  await ensureIQProfileTable(fastify);

  // GET /me/iq-profile — Full identity card data
  fastify.get('/me/iq-profile', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      const profile = await getIQProfile(fastify, userId);
      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }
      return reply.send({ success: true, data: profile });
    } catch (err) {
      fastify.log.error('iq-profile error:', err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch IQ profile' },
      });
    }
  });

  // POST /me/iq-profile/refresh — Force recompute
  fastify.post('/me/iq-profile/refresh', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      // Invalidate cache
      await fastify.redis.del(`iq:${userId}`);
      const profile = await computeIQProfile(fastify, userId);
      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }
      return reply.send({ success: true, data: profile });
    } catch (err) {
      fastify.log.error('iq-profile refresh error:', err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to refresh IQ profile' },
      });
    }
  });

  // POST /me/iq-profile/badges — Re-check badge awards (call after completing quizzes)
  fastify.post('/me/iq-profile/badges', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      const newBadges = await awardCategoryBadges(fastify, userId);
      return reply.send({ success: true, data: { newBadges } });
    } catch (err) {
      fastify.log.error('badge award error:', err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check badges' },
      });
    }
  });

  // POST /admin/iq-percentiles — Run daily percentile job (admin only)
  fastify.post('/admin/iq-percentiles', { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin only' },
      });
    }
    try {
      const result = await runDailyPercentileJob(fastify);
      return reply.send({ success: true, data: result });
    } catch (err) {
      fastify.log.error('percentile job error:', err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to run percentile job' },
      });
    }
  });
};

export default iqProfileRoutes;