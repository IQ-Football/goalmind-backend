import { authenticate } from '../middleware/auth.js';
import { getDailyBattleStats } from '../services/battleService.js';
import { getUserReferralStats } from '../services/referralService.js';

const userRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /users/me - Current user profile + Elo
  fastify.get('/me', async (request, reply) => {
    const userId = request.user.id;

    try {
      const result = await fastify.db.query(
        `SELECT u.id, u.username, u.email, u.tribe_id, u.elo, u.battles_played, 
                u.battles_won, u.last_active_at, u.created_at,
                u.is_pro, u.goal_tokens, u.gems, u.pro_expires_at, u.battle_tokens, u.last_token_refill_at,
                t.name as tribe_name, t.slug as tribe_slug, t.type as tribe_type,
                t.primary_color, t.secondary_color,
                tm.tier, tm.contribution_points
         FROM users u
         LEFT JOIN tribes t ON u.tribe_id = t.id
         LEFT JOIN tribe_members tm ON u.id = tm.user_id
         WHERE u.id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId: request.id,
          },
        });
      }

      const user = result.rows[0];

      // Get user's global rank from Redis
      const rank = await fastify.redis.zrevrank('leaderboard:global', userId);
      const elo = await fastify.redis.zscore('leaderboard:global', userId);
      const usage = await getDailyBattleStats(fastify, userId);

      return reply.send({
        success: true,
        data: {
          user,
          globalRank: rank !== null ? rank + 1 : null,
          elo: parseInt(elo) || user.elo,
          usage,
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
          message: 'Failed to fetch user profile',
          requestId: request.id,
        },
      });
    }
  });

  // GET /users/me/referrals - Get user's referral stats
  fastify.get('/me/referrals', async (request, reply) => {
    const userId = request.user.id;
    try {
      const stats = await getUserReferralStats(fastify, userId);
      return reply.send({
        success: true,
        data: stats,
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch referral stats', requestId: request.id }
      });
    }
  });

  // GET /users/me/tokens - Return current token balance
  fastify.get('/me/tokens', async (request, reply) => {
    const userId = request.user.id;

    try {
      const result = await fastify.db.query(
        'SELECT goal_tokens, gems, battle_tokens, is_pro FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found', requestId: request.id }
        });
      }

      return reply.send({
        success: true,
        data: {
          goalTokens: result.rows[0].goal_tokens,
          gems: result.rows[0].gems,
          battleTokens: result.rows[0].battle_tokens,
          isPro: result.rows[0].is_pro,
        },
        meta: { timestamp: new Date().toISOString(), requestId: request.id }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch token balance', requestId: request.id }
      });
    }
  });

  // GET /users/me/achievements - Current user achievements/badges
  fastify.get('/me/achievements', async (request, reply) => {
    const userId = request.user.id;

    try {
      const result = await fastify.db.query(
        `SELECT a.id, a.name as title, a.description, a.badge_url as icon_url, a.tier as rarity, ua.earned_at as awarded_at
         FROM achievements a
         JOIN user_achievements ua ON a.id = ua.achievement_id
         WHERE ua.user_id = $1
         ORDER BY ua.earned_at DESC`,
        [userId]
      );

      return reply.send({
        success: true,
        data: result.rows,
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
          message: 'Failed to fetch user achievements',
          requestId: request.id,
        },
      });
    }
  });

  // GET /users/:id/stats - Public stats for any user
  fastify.get('/:id/stats', async (request, reply) => {
    const { id } = request.params;

    try {
      const result = await fastify.db.query(
        `SELECT u.id, u.username, u.tribe_id, u.elo, u.battles_played, 
                u.battles_won, u.created_at,
                t.name as tribe_name, t.slug as tribe_slug,
                tm.tier, tm.contribution_points
         FROM users u
         LEFT JOIN tribes t ON u.tribe_id = t.id
         LEFT JOIN tribe_members tm ON u.id = tm.user_id
         WHERE u.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId: request.id,
          },
        });
      }

      const user = result.rows[0];

      // Get global rank
      const rank = await fastify.redis.zrevrank('leaderboard:global', id);

      return reply.send({
        success: true,
        data: {
          user,
          globalRank: rank !== null ? rank + 1 : null,
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
          message: 'Failed to fetch user stats',
          requestId: request.id,
        },
      });
    }
  });
};

export default userRoutes;
