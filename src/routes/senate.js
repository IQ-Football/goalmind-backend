import { authenticate } from '../middleware/auth.js';
import { castSenateVote, getProposalResults } from '../services/governanceService.js';

const senateRoutes = async (fastify, options) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /api/v1/senate/poll/vote
   * Cast a vote in a Senate poll
   * Body: { proposalId, optionId }
   */
  fastify.post('/poll/vote', async (request, reply) => {
    const { proposalId, optionId } = request.body;
    const userId = request.user.id;

    if (!proposalId || !optionId) {
      return reply.status(400).send({ success: false, error: 'proposalId and optionId are required' });
    }

    // 1. Throttling: Limit to 1 vote attempt per 5 seconds per user per proposal
    if (fastify.redis) {
      const throttleKey = `senate:poll:throttle:${userId}:${proposalId}`;
      const existing = await fastify.redis.get(throttleKey);
      if (existing) {
        return reply.status(429).send({ success: false, error: 'Please wait before voting again' });
      }
      await fastify.redis.set(throttleKey, '1', 'EX', 5);
    }

    try {
      const result = await castSenateVote(fastify, { proposalId, userId, optionId });
      
      // 2. Invalidate results cache for this proposal
      if (fastify.redis) {
        await fastify.redis.del(`senate:poll:results:${proposalId}`);
      }

      return reply.send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/v1/senate/poll/results
   * Fetch real-time percentage results for a Senate poll
   * Query: ?proposalId=...
   */
  fastify.get('/poll/results', async (request, reply) => {
    const { proposalId } = request.query;

    if (!proposalId) {
      return reply.status(400).send({ success: false, error: 'proposalId is required' });
    }

    const cacheKey = `senate:poll:results:${proposalId}`;

    try {
      // 1. Try to get from Redis cache
      if (fastify.redis) {
        const cachedResults = await fastify.redis.get(cacheKey);
        if (cachedResults) {
          return reply.send({ 
            success: true, 
            data: JSON.parse(cachedResults),
            cached: true 
          });
        }
      }

      const results = await getProposalResults(fastify, proposalId);
      
      // Calculate percentages
      const totalWeight = results.reduce((sum, row) => sum + parseFloat(row.total_weight), 0);
      
      const formattedResults = results.map(row => ({
        optionId: row.option_id,
        totalWeight: parseFloat(row.total_weight),
        voteCount: parseInt(row.vote_count),
        percentage: totalWeight > 0 ? (parseFloat(row.total_weight) / totalWeight) * 100 : 0
      }));

      const responseData = {
        proposalId,
        totalWeight,
        results: formattedResults
      };

      // 2. Store in Redis cache for 60 seconds
      if (fastify.redis) {
        await fastify.redis.set(cacheKey, JSON.stringify(responseData), 'EX', 60);
      }

      return reply.send({ 
        success: true, 
        data: responseData
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
    }
  });
};

export default senateRoutes;
