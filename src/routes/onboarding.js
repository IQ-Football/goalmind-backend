import onboardingService from '../services/onboardingService.js';
import { authenticate } from '../middleware/auth.js';

/**
 * Onboarding Routes
 */
export default async function (fastify, opts) {
  
  // Suggest tribe based on IP
  fastify.get('/suggest-tribe', async (request, reply) => {
    const ip = request.ip;
    const suggestion = await onboardingService.suggestTribe(fastify, ip);
    return suggestion;
  });

  // Start trial battle (creates guest session and returns questions)
  fastify.post('/trial/start', {
    schema: {
      body: {
        type: 'object',
        required: ['tribeId'],
        properties: {
          tribeId: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, async (request, reply) => {
    const { tribeId } = request.body;
    const session = await onboardingService.createGuestSession(fastify, tribeId);
    const questions = await onboardingService.getTrialBlitzQuestions(fastify);
    
    return {
      sessionId: session.session_id,
      questions
    };
  });

  // Submit trial battle result
  fastify.post('/trial/submit', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId', 'score'],
        properties: {
          sessionId: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 3 }
        }
      }
    }
  }, async (request, reply) => {
    const { sessionId, score } = request.body;
    const session = await onboardingService.recordTrialResult(fastify, sessionId, score);
    return { success: true, session };
  });

  // Merge guest data (called after user registers)
  // This route requires authentication
  fastify.post('/merge', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string' }
        }
      }
    },
    preHandler: [authenticate]
  }, async (request, reply) => {
    const { sessionId } = request.body;
    const userId = request.user.id;
    
    const result = await onboardingService.mergeGuestData(fastify, sessionId, userId);
    if (!result) {
      return reply.code(404).send({ error: 'Guest session not found' });
    }
    
    return result;
  });

}
