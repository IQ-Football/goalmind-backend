import { authenticate, checkAdmin } from '../middleware/auth.js';
import { awardBadge, awardBadgeWithTribeCap, awardFoundingGeneral, awardFoundingCenturion, FOUNDING_GENERAL_ID, FOUNDING_CAPTAIN_ID, FOUNDING_CENTURION_ID, FOUNDING_THRESHOLD } from '../services/achievementService.js';

const achievementRoutes = async (fastify, options) => {
  // GET /achievements - User's earned badges (requires auth)
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user.id;

    try {
      const result = await fastify.db.query(
        `SELECT a.id, a.name, a.description, a.badge_url, a.tier, ua.earned_at
         FROM achievements a
         JOIN user_achievements ua ON a.id = ua.achievement_id
         WHERE ua.user_id = $1
         ORDER BY ua.earned_at DESC`,
        [userId]
      );

      return reply.send({
        success: true,
        data: {
          achievements: result.rows,
          totalEarned: result.rows.length,
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
          message: 'Failed to fetch achievements',
          requestId: request.id,
        },
      });
    }
  });

  // GET /achievements/all - All available achievements (for discovery)
  fastify.get('/all', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const result = await fastify.db.query(
        `SELECT id, name, description, badge_url, tier, criteria
         FROM achievements
         ORDER BY tier, name`
      );

      // Get user's earned achievements
      const userId = request.user?.id;
      let earnedIds = [];
      
      if (userId) {
        const earnedResult = await fastify.db.query(
          'SELECT achievement_id FROM user_achievements WHERE user_id = $1',
          [userId]
        );
        earnedIds = earnedResult.rows.map(r => r.achievement_id);
      }

      const achievementsWithStatus = result.rows.map(a => ({
        ...a,
        earned: earnedIds.includes(a.id),
      }));

      return reply.send({
        success: true,
        data: {
          achievements: achievementsWithStatus,
          totalAvailable: result.rows.length,
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
          message: 'Failed to fetch achievements',
          requestId: request.id,
        },
      });
    }
  });

  // POST /achievements/award - Manually award a badge (Admin only)
  fastify.post('/award', { preHandler: [authenticate, checkAdmin] }, async (request, reply) => {
    const { userId, achievementId, force = false } = request.body;

    if (!userId || !achievementId) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'userId and achievementId are required',
          requestId: request.id,
        },
      });
    }

    try {
      // Check if achievement exists
      const achCheck = await fastify.db.query(
        'SELECT id, name FROM achievements WHERE id = $1',
        [achievementId]
      );

      if (achCheck.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Achievement not found',
            requestId: request.id,
          },
        });
      }

      // Award the badge
      let result = { success: false };
      if (achievementId === FOUNDING_GENERAL_ID) {
        result = await awardFoundingGeneral(fastify, userId, force);
      } else if (achievementId === FOUNDING_CENTURION_ID) {
        result = await awardFoundingCenturion(fastify, userId, force);
      } else {
        await fastify.db.query(
          `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, achievement_id) DO NOTHING`,
          [userId, achievementId]
        );
        result = { success: true };
      }

      if (!result.success) {
        const message = result.reason === 'cap_reached' 
          ? `Tribe cap reached for this badge (${result.count}). Use force: true to override.`
          : 'Failed to award badge.';
        return reply.status(400).send({
          success: false,
          error: {
            code: result.reason || 'AWARD_FAILED',
            message,
            requestId: request.id,
          },
        });
      }

      fastify.log.info({ admin: request.user.id, userId, achievementId }, 'Badge manually awarded');

      return reply.send({
        success: true,
        data: {
          message: `Badge '${achCheck.rows[0].name}' awarded successfully to user ${userId}`,
          signupNumber: result.signupNumber,
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
          message: 'Failed to award achievement',
          requestId: request.id,
        },
      });
    }
  });

  // POST /achievements/award/founding-general - Specialized awarding for partner admins (Admin only)
  // Body: { email, force }
  fastify.post('/award/founding-general', { preHandler: [authenticate, checkAdmin] }, async (request, reply) => {
    const { email, force = false } = request.body;
    const achievementId = '550e8400-e29b-41d4-a716-446655440000';

    if (!email) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'email is required',
          requestId: request.id,
        },
      });
    }

    try {
      // Find user by email
      const userResult = await fastify.db.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User with this email not found',
            requestId: request.id,
          },
        });
      }

      const userId = userResult.rows[0].id;

      // Award the badge with strict tribe cap (max 10) unless forced
      const result = await awardFoundingGeneral(fastify, userId, force);

      if (!result.success) {
        const message = result.reason === 'cap_reached' 
          ? 'Tribe cap reached for Founding General badge. Use force: true to override.'
          : 'Failed to award Founding General badge.';
        return reply.status(400).send({
          success: false,
          error: {
            code: result.reason || 'AWARD_FAILED',
            message,
            requestId: request.id,
          },
        });
      }

      fastify.log.info({ admin: request.user.id, userId, email, achievementId: FOUNDING_GENERAL_ID }, 'Founding General badge manually awarded');

      return reply.send({
        success: true,
        data: {
          message: `Founding General badge awarded successfully to ${email}`,
          userId,
          achievementId: FOUNDING_GENERAL_ID,
          signupNumber: result.signupNumber,
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
          message: 'Failed to award Founding General badge',
          requestId: request.id,
        },
      });
    }
  });

  // POST /achievements/award/founding-captain - Manual awarding for community leaders (Admin only)
  // Body: { email }
  fastify.post('/award/founding-captain', { preHandler: [authenticate, checkAdmin] }, async (request, reply) => {
    const { email } = request.body;

    if (!email) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'email is required',
          requestId: request.id,
        },
      });
    }

    try {
      // Find user by email
      const userResult = await fastify.db.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User with this email not found',
            requestId: request.id,
          },
        });
      }

      const userId = userResult.rows[0].id;

      // Award the badge (no cap)
      await awardBadge(fastify, userId, FOUNDING_CAPTAIN_ID);

      fastify.log.info({ admin: request.user.id, userId, email, achievementId: FOUNDING_CAPTAIN_ID }, 'Founding Captain badge manually awarded');

      return reply.send({
        success: true,
        data: {
          message: `Founding Captain badge awarded successfully to ${email}`,
          userId,
          achievementId: FOUNDING_CAPTAIN_ID,
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
          message: 'Failed to award Founding Captain badge',
          requestId: request.id,
        },
      });
    }
  });
};

export default achievementRoutes;
