import { suggestTribe, createGuestSession, getTrialBlitzQuestions, mergeGuestData } from '../services/onboardingService.js';

export default async function (fastify) {
  /**
   * GET /api/v1/onboarding/suggest-tribe
   * Suggest a tribe based on Geo-IP (headers)
   */
  fastify.get('/suggest-tribe', async (request, reply) => {
    const countryCode = (request.headers['cf-ipcountry'] || request.headers['x-country-code'] || 'NG').toUpperCase();
    const cacheKey = `cache:onboarding:suggest:${countryCode}`;

    try {
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      const suggestion = await suggestTribe(fastify, countryCode);
      
      const response = {
        success: true,
        data: {
          countryCode,
          suggestedTribe: suggestion,
          reason: suggestion ? `Popular in your region (${suggestion.region})` : 'Default global recommendation'
        }
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 3600);
      return response;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
    }
  });

  /**
   * POST /api/v1/onboarding/create-guest-session
   * Create a temporary guest user/session
   */
  fastify.post('/create-guest-session', async (request, reply) => {
    const { tribeId, trialTokens } = request.body || {};
    try {
      const guest = await createGuestSession(fastify, { tribeId, trialTokens });
      
      // Generate a JWT for the guest so they can interact with authenticated endpoints if needed
      // although Ghost Mode mostly uses unauthenticated ones.
      const token = fastify.jwt.sign({ 
        id: guest.id, 
        role: guest.role, 
        tribeId: guest.tribe_id 
      });

      return {
        success: true,
        data: {
          guest,
          token
        }
      };
    } catch (err) {
      if (err.message === 'TRIBE_REQUIRED') {
        return reply.code(400).send({ error: 'Tribe ID is required' });
      }
      throw err;
    }
  });

  /**
   * GET /api/v1/onboarding/get-trial-questions
   * Fetch 3 easy questions for the Ghost Mode blitz
   */
  fastify.get('/get-trial-questions', async (request, reply) => {
    const cacheKey = 'cache:onboarding:trial-questions';
    
    try {
      // Short cache (10s) to provide some variety but prevent DB hammering
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const questions = await getTrialBlitzQuestions(fastify);
      const response = {
        success: true,
        data: {
          questions: questions.map(q => ({
            id: q.id,
            content: q.content,
            options: q.options,
            difficulty: q.difficulty
          }))
        }
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 10);
      return response;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
    }
  });

  /**
   * POST /api/v1/onboarding/merge-guest-data
   * Finalize conversion bonus (Auth required)
   */
  fastify.post('/merge-guest-data', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const result = await mergeGuestData(fastify, userId);
    return result;
  });
}
