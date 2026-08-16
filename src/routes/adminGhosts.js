/**
 * Admin Ghost Tooling Routes
 *
 * Endpoints:
 *  GET /admin/ghosts/segments — Live ghost segmentation report (admin only)
 *
 * Registered with prefix '/admin' in server.js.
 */
import { authenticate, checkAdmin } from '../middleware/auth.js';
import { buildGhostSegments } from '../services/ghostSegmentationService.js';

export default async function adminGhostRoutes(fastify, opts) {
  // GET /admin/ghosts/segments — segmentation of users with no tribe
  fastify.get('/ghosts/segments', {
    preHandler: [authenticate, checkAdmin],
  }, async (request, reply) => {
    try {
      const segments = await buildGhostSegments(fastify.db);
      return reply.send({
        success: true,
        data: segments,
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error({ err }, 'Ghost segmentation failed');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to build ghost segments',
          requestId: request.id,
        },
      });
    }
  });
}
