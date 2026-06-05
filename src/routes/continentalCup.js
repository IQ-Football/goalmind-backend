import continentalCupService from '../services/continentalCupService.js';

/**
 * Continental Cup Routes
 */
export default async function (fastify, opts) {
  
  // Get active season info
  fastify.get('/season/active', async (request, reply) => {
    const season = await continentalCupService.getActiveSeason(fastify);
    if (!season) {
      return reply.code(404).send({ error: 'No active season' });
    }
    return season;
  });

  // Get cup leaderboard
  fastify.get('/leaderboard/:seasonId', async (request, reply) => {
    const { seasonId } = request.params;
    const leaderboard = await continentalCupService.getCupLeaderboard(fastify, seasonId);
    return { leaderboard };
  });

  // Issue bounty challenge
  fastify.post('/bounty/challenge', {
    schema: {
      body: {
        type: 'object',
        required: ['challengedId'],
        properties: {
          challengedId: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, async (request, reply) => {
    const challengerId = request.user.id;
    const { challengedId } = request.body;
    
    try {
      const challenge = await continentalCupService.issueBountyChallenge(fastify, challengerId, challengedId);
      return challenge;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Admin: Force TPI update
  fastify.post('/admin/update-tpi', async (request, reply) => {
    // Basic admin check (if role exists)
    if (request.user.role !== 'admin' && request.user.role !== 'lead_engineer') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    
    const season = await continentalCupService.getActiveSeason(fastify);
    if (!season) {
      return reply.code(404).send({ error: 'No active season' });
    }
    
    await continentalCupService.updateAllTpi(fastify, season.id);
    return { success: true };
  });

}
