/**
 * Prestige Reward Routes
 */

import { claimFoundingRewards } from '../services/prestigeRewardService.js';

export default async function (fastify) {
  /**
   * POST /api/v1/prestige/claim-founding-rewards
   * One-tap claim for Founding 50k rewards
   */
  fastify.post('/claim-founding-rewards', { 
    preHandler: [fastify.authenticate],
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const userId = request.user.id;
    
    try {
      const result = await claimFoundingRewards(fastify, userId);
      
      if (!result.success) {
        return reply.code(400).send(result);
      }
      
      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ 
        success: false, 
        error: 'INTERNAL_ERROR', 
        message: 'Failed to claim rewards. Please try again later.' 
      });
    }
  });
}
