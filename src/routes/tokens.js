import { getTokenBalance, getTokenHistory, purchaseItem, TRANSACTION_TYPES } from '../services/goalTokenService.js';

export default async function (fastify) {
  /**
   * GET /tokens/balance
   * Fetch current user's GoalToken balance and Legacy XP
   */
  fastify.get('/balance', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const balance = await getTokenBalance(fastify, userId);
    return balance;
  });

  /**
   * GET /tokens/history
   * Fetch current user's GoalToken transaction history
   */
  fastify.get('/history', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const { limit, offset } = request.query;
    const history = await getTokenHistory(fastify, userId, parseInt(limit) || 50, parseInt(offset) || 0);
    return { history };
  });

  /**
   * POST /tokens/purchase
   * Purchase an item (Tournament entry, Rank freeze, etc.)
   */
  fastify.post('/purchase', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const { itemType, referenceId, metadata } = request.body;
    
    if (!itemType) {
      return reply.code(400).send({ error: 'Item type is required' });
    }

    try {
      const result = await purchaseItem(fastify, { userId, itemType, referenceId, metadata });
      if (!result.success) {
        return reply.code(402).send(result); // 402 Payment Required
      }
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
