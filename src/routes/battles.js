import { authenticate } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { isDailyBattleLimitReached, incrementDailyBattleCount } from '../services/battleService.js';

const battleRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /battles/history - User's battle history
  fastify.get('/history', async (request, reply) => {
    const userId = request.user.id;
    const { limit = 20, offset = 0 } = request.query;

    try {
      const result = await fastify.db.query(
        `SELECT b.id, b.player1_id, b.player2_id, b.winner_id,
                b.player1_score, b.player2_score,
                b.player1_elo_change, b.player2_elo_change,
                b.status, b.created_at, b.ended_at,
                u1.username as player1_username, u2.username as player2_username,
                t.name as winning_tribe_name
         FROM battles b
         JOIN users u1 ON b.player1_id = u1.id
         JOIN users u2 ON b.player2_id = u2.id
         LEFT JOIN users w ON b.winner_id = w.id
         LEFT JOIN tribes t ON w.tribe_id = t.id
         WHERE b.player1_id = $1 OR b.player2_id = $1
         ORDER BY b.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      // Get total count for pagination
      const countResult = await fastify.db.query(
        `SELECT COUNT(*) FROM battles WHERE player1_id = $1 OR player2_id = $1`,
        [userId]
      );

      return reply.send({
        success: true,
        data: {
          battles: result.rows,
          pagination: {
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset),
          },
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
          message: 'Failed to fetch battle history',
          requestId: request.id,
        },
      });
    }
  });

  // POST /battles/challenge - Issue direct challenge
  fastify.post('/challenge', {
    schema: {
      body: {
        type: 'object',
        required: ['opponentId'],
        properties: {
          opponentId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const challengerId = request.user.id;
    const { opponentId } = request.body;

    if (challengerId === opponentId) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_CHALLENGE',
          message: 'Cannot challenge yourself',
          requestId: request.id,
        },
      });
    }

    try {
      // Check for daily usage limit
      const limitReached = await isDailyBattleLimitReached(fastify, challengerId);
      if (limitReached) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'DAILY_LIMIT_REACHED',
            message: 'You have reached your daily limit of 5 battles. Upgrade to GoalMind Pro for unlimited access!',
            requestId: request.id,
          },
        });
      }

      // Verify opponent exists and is available
      const opponentResult = await fastify.db.query(
        'SELECT id, username, elo, tribe_id FROM users WHERE id = $1',
        [opponentId]
      );

      if (opponentResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'OPPONENT_NOT_FOUND',
            message: 'Opponent not found',
            requestId: request.id,
          },
        });
      }

      // Create pending battle
      const battleId = uuidv4();
      const result = await fastify.db.query(
        `INSERT INTO battles (id, player1_id, player2_id, status) 
         VALUES ($1, $2, $3, 'pending')
         RETURNING *`,
        [battleId, challengerId, opponentId]
      );

      return reply.status(201).send({
        success: true,
        data: {
          battle: result.rows[0],
          message: 'Challenge sent. Waiting for opponent to accept.',
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
          message: 'Failed to create challenge',
          requestId: request.id,
        },
      });
    }
  });

  // POST /battles/refill - Spend 50 GoalTokens to refill battle tokens
  fastify.post('/refill', async (request, reply) => {
    const userId = request.user.id;
    const REFILL_COST = 50;

    try {
      // 1. Check user's gems
      const userResult = await fastify.db.query('SELECT gems, is_pro, battle_tokens FROM users WHERE id = $1', [userId]);
      const user = userResult.rows[0];

      if (user.is_pro) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ALREADY_PRO', message: 'Pro users already have unlimited battles', requestId: request.id }
        });
      }

      if ((user.gems || 0) < REFILL_COST) {
        return reply.status(402).send({
          success: false,
          error: { code: 'INSUFFICIENT_GEMS', message: `Refill costs ${REFILL_COST} GoalTokens. You only have ${user.gems || 0}.`, requestId: request.id }
        });
      }

      // 2. Deduct gems and refill battle tokens
      await fastify.db.query(
        'UPDATE users SET gems = gems - $1, battle_tokens = 5, last_token_refill_at = NOW() WHERE id = $2',
        [REFILL_COST, userId]
      );
      
      // Also reset daily counter in Redis for legacy compatibility/stats
      const today = new Date().toISOString().split('T')[0];
      await fastify.redis.del(`user:${userId}:battles_count:${today}`);

      return reply.send({
        success: true,
        data: {
          message: 'Battle tokens refilled!',
          remainingGems: user.gems - REFILL_COST,
          battleTokens: 5,
        },
        meta: { timestamp: new Date().toISOString(), requestId: request.id }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to refill tokens', requestId: request.id }
      });
    }
  });
};

export default battleRoutes;
