
/**
 * Governance Service
 * Handles tribal proposals and voting with weighted authority.
 */

export async function createProposal(fastify, { tribeId, title, description, options, endsAt }) {
  const result = await fastify.db.query(
    `INSERT INTO tribal_proposals (tribe_id, title, description, options, ends_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tribeId, title, JSON.stringify(options), description, endsAt]
  );
  return result.rows[0];
}

export async function castVote(fastify, { proposalId, userId, optionId }) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Check if proposal is active
    const proposalRes = await client.query(
      'SELECT status, ends_at, tribe_id FROM tribal_proposals WHERE id = $1',
      [proposalId]
    );
    const proposal = proposalRes.rows[0];

    if (!proposal || proposal.status !== 'active' || (proposal.ends_at && new Date(proposal.ends_at) < new Date())) {
      throw new Error('Proposal is not active');
    }

    // 2. Check if user belongs to the tribe
    const userRes = await client.query(
      'SELECT tribe_id FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows[0].tribe_id !== proposal.tribe_id) {
      throw new Error('User does not belong to this tribe');
    }

    // 3. Calculate Weight (FG gets 2x, Vanguard 500 gets 1.5x)
    const fgRes = await client.query(
      'SELECT is_founding_general FROM tribe_members WHERE user_id = $1',
      [userId]
    );
    const cohortRes = await client.query(
      'SELECT cohort FROM users WHERE id = $1',
      [userId]
    );
    
    let weight = 1.0;
    if (fgRes.rows[0]?.is_founding_general) weight *= 2.0;
    if (cohortRes.rows[0]?.cohort === 'vanguard_500') weight *= 1.5;

    // 4. Cast or Update Vote
    await client.query(
      `INSERT INTO tribal_votes (proposal_id, user_id, option_id, weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (proposal_id, user_id) 
       DO UPDATE SET option_id = EXCLUDED.option_id, weight = EXCLUDED.weight`,
      [proposalId, userId, optionId, weight]
    );

    await client.query('COMMIT');
    return { success: true, weight };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getProposalResults(fastify, proposalId) {
  const results = await fastify.db.query(
    `SELECT option_id, SUM(weight) as total_weight, COUNT(*) as vote_count
     FROM tribal_votes
     WHERE proposal_id = $1
     GROUP BY option_id`,
    [proposalId]
  );
  return results.rows;
}

export default {
  createProposal,
  castVote,
  getProposalResults
};
