import { authenticate } from '../middleware/auth.js';
import { createProposal, castVote, getProposalResults } from '../services/governanceService.js';
import { awardFoundingGeneral } from '../services/achievementService.js';

const governanceRoutes = async (fastify, options) => {
  fastify.addHook('preHandler', authenticate);

  // Helper to check for admin role
  const checkAdmin = async (request, reply) => {
    const userResult = await fastify.db.query('SELECT role FROM users WHERE id = $1', [request.user.id]);
    if (userResult.rows[0]?.role !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Only admins can perform this action' });
    }
  };

  // POST /governance/proposals - Create a new tribal proposal (Admin only for now)
  fastify.post('/proposals', { preHandler: [checkAdmin] }, async (request, reply) => {
    const { tribeId, title, description, options, endsAt } = request.body;
    try {
      const proposal = await createProposal(fastify, { tribeId, title, description, options, endsAt });
      return reply.send({ success: true, data: proposal });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
    }
  });

  /**
   * POST /governance/award-founding-general
   * Award the 'Founding General' badge manually (Admin only)
   * Body: { userId, email, username, force, manualSignupNumber }
   */
  fastify.post('/award-founding-general', { preHandler: [checkAdmin] }, async (request, reply) => {
    const { userId: providedUserId, email, username, force, manualSignupNumber } = request.body;
    
    if (!providedUserId && !email && !username) {
      return reply.status(400).send({ success: false, error: 'userId, email, or username is required' });
    }

    try {
      let userId = providedUserId;
      if (!userId) {
        let query = '';
        let params = [];
        if (email) {
          query = 'SELECT id FROM users WHERE email = $1';
          params = [email.toLowerCase()];
        } else {
          query = 'SELECT id FROM users WHERE username = $1';
          params = [username];
        }
        const userRes = await fastify.db.query(query, params);
        if (userRes.rows.length === 0) {
          return reply.status(404).send({ success: false, error: 'User not found' });
        }
        userId = userRes.rows[0].id;
      }

      const result = await awardFoundingGeneral(fastify, userId, force, manualSignupNumber);
      if (!result.success && result.reason === 'cap_reached') {
          return reply.status(400).send({
              success: false,
              reason: 'cap_reached',
              message: `Tribe cap reached (${result.count}/10). Use force: true to override.`
          });
      }
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // GET /governance/proposals/:tribeId - List proposals for a tribe
  fastify.get('/proposals/:tribeId', async (request, reply) => {
    const { tribeId } = request.params;
    try {
      const result = await fastify.db.query(
        'SELECT * FROM tribal_proposals WHERE tribe_id = $1 ORDER BY created_at DESC',
        [tribeId]
      );
      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
    }
  });

  // POST /governance/vote - Cast a vote
  fastify.post('/vote', async (request, reply) => {
    const { proposalId, optionId } = request.body;
    const userId = request.user.id;
    try {
      const result = await castVote(fastify, { proposalId, userId, optionId });
      return reply.send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // GET /governance/proposals/:proposalId/results
  fastify.get('/proposals/:proposalId/results', async (request, reply) => {
    const { proposalId } = request.params;
    try {
      const results = await getProposalResults(fastify, proposalId);
      return reply.send({ success: true, data: results });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
    }
  });
};

export default governanceRoutes;
