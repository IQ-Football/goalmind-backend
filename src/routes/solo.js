import { authenticate } from '../middleware/auth.js';
import {
  getHistoricalScenarios,
  getScenarioById,
  getScenarioQuestions,
  processScenarioAttempt,
  getDailyQuests,
  getWeeklyQuests,
  getSkillTrees,
  getUserMasteryPoints,
} from '../services/soloChallengeService.js';

const soloRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /solo/daily - Get today's daily quests
  fastify.get('/daily', async (request, reply) => {
    try {
      const quests = await getDailyQuests(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { quests },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch daily quests', requestId: request.id },
      });
    }
  });

  // GET /solo/weekly - Get this week's quests
  fastify.get('/weekly', async (request, reply) => {
    try {
      const quests = await getWeeklyQuests(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { quests },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch weekly quests', requestId: request.id },
      });
    }
  });

  // GET /solo/scenarios - List all historical scenarios
  fastify.get('/scenarios', async (request, reply) => {
    try {
      const scenarios = getHistoricalScenarios();
      return reply.send({
        success: true,
        data: { scenarios },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch scenarios', requestId: request.id },
      });
    }
  });

  // GET /solo/scenarios/:id - Get questions for a specific scenario
  fastify.get('/scenarios/:id', async (request, reply) => {
    const { id } = request.params;
    const scenario = getScenarioById(id);
    
    if (!scenario) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Scenario not found', requestId: request.id },
      });
    }

    // Return questions without answers
    const questions = getScenarioQuestions(id);
    return reply.send({
      success: true,
      data: {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        category: scenario.category,
        difficulty: scenario.difficulty,
        questionCount: scenario.questions.length,
        questions,
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // POST /solo/scenarios/:id/submit - Submit answers for a scenario
  fastify.post('/scenarios/:id/submit', async (request, reply) => {
    const { id } = request.params;
    const { answers } = request.body;

    if (!answers || !Array.isArray(answers)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Answers must be an array', requestId: request.id },
      });
    }

    const scenario = getScenarioById(id);
    if (!scenario) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Scenario not found', requestId: request.id },
      });
    }

    const result = await processScenarioAttempt(fastify, request.user.id, id, answers);

    if (result.error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: result.error, requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: {
        scenarioName: scenario.name,
        score: result.score,
        correctAnswers: result.correctAnswers,
        totalQuestions: result.totalQuestions,
        passed: result.passed,
        masteryPointsEarned: result.passed ? 10 : 0,
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // GET /solo/skill-trees - Get available skill trees
  fastify.get('/skill-trees', async (request, reply) => {
    try {
      const trees = getSkillTrees();
      return reply.send({
        success: true,
        data: { skillTrees: trees },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch skill trees', requestId: request.id },
      });
    }
  });

  // GET /solo/mastery - Get user's mastery status
  fastify.get('/mastery', async (request, reply) => {
    try {
      const masteryPoints = await getUserMasteryPoints(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { masteryPoints },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch mastery status', requestId: request.id },
      });
    }
  });
};

export default soloRoutes;