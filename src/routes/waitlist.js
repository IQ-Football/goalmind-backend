/**
 * Waitlist Routes — The Recruitment Drive
 * 
 * Endpoints:
 * POST /waitlist/signup — Register a new waitlist signup
 * GET /waitlist/count — Get total signups with optional per-tribe breakdown
 */

import { registerWaitlistSignup, getWaitlistCount, completeWaitlistOnboarding } from '../services/waitlistService.js';

const waitlistRoutes = async (fastify, options) => {

  // POST /waitlist/signup — Register a new waitlist signup
  // Body: { name, email, tribeId, referralCode? }
  fastify.post('/signup', async (request, reply) => {
    const { name, email, tribeId, referralCode } = request.body || {};

    if (!email) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email is required',
        },
      });
    }

    const result = await registerWaitlistSignup(fastify, {
      name,
      email,
      tribeId,
      referralCode,
    });

    if (result.error) {
      const statusMap = {
        VALIDATION_ERROR: 400,
        INVALID_TRIBE: 404,
        ALREADY_REGISTERED: 409,
      };
      return reply.status(statusMap[result.error] || 500).send({
        success: false,
        error: { code: result.error, message: result.message },
      });
    }

    fastify.log.info(`Waitlist signup success: ${email}, referralCode: ${result.user.referralCode}`);
    return reply.status(201).send({
      success: true,
      data: result,
    });
  });

  // POST /waitlist/onboard — Complete waitlist onboarding
  // Body: { email, username, tribeId }
  fastify.post('/onboard', async (request, reply) => {
    const { email, username, tribeId } = request.body || {};

    if (!email || !username || !tribeId) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email, username, and tribeId are required',
        },
      });
    }

    const result = await completeWaitlistOnboarding(fastify, {
      email,
      username,
      tribeId,
    });

    if (result.error) {
      const statusMap = {
        VALIDATION_ERROR: 400,
        INVALID_TRIBE: 404,
        USER_NOT_FOUND: 404,
      };
      return reply.status(statusMap[result.error] || 500).send({
        success: false,
        error: { code: result.error, message: result.message },
      });
    }

    fastify.log.info(`Waitlist onboarding success: ${email} -> username: ${username}, tribe: ${tribeId}`);
    return reply.send({
      success: true,
      data: result,
    });
  });

  // GET /waitlist/count — Get total waitlist count
  // Query: ?by_tribe=true for per-tribe breakdown
  fastify.get('/count', async (request, reply) => {
    const { by_tribe } = request.query;

    const result = await getWaitlistCount(fastify, {
      byTribe: by_tribe === 'true' || by_tribe === '1',
    });

    if (result.error) {
      return reply.status(500).send({
        success: false,
        error: { code: result.error, message: result.message },
      });
    }

    return reply.send({
      success: true,
      data: result.data,
    });
  });

};

export default waitlistRoutes;