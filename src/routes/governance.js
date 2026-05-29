
import { authenticate } from '../middleware/auth.js';
import { createProposal, castVote, getProposalResults } from '../services/governanceService.js';

const governanceRoutes = async (fastify, options) => {
  fastify.addHook('preHandler', authenticate);

  // POST /governance/proposals - Create a new tribal proposal (Admin only for now)
  fastify.post('/proposals', async (request, reply) => {
    // Basic admin check (could be refined)
    const userResult = await fastify.db.query('SELECT role FROM users WHERE id = $1', [request.user.id]);
    if (userResult.rows[0].role !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Only admins can create proposals' });
    }

    const { tribeId, title, description, options, endsAt } = request.body;
    try {
      const proposal = await createProposal(fastify, { tribeId, title, description, options, endsAt });
      return reply.send({ success: true, data: proposal });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Internal Error' });
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
