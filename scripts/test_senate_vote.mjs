
import { Pool } from 'pg';
import crypto from 'crypto';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres'
});

async function testSenateVoting() {
  const proposalId = '550e8400-e29b-41d4-a716-446655440001';
  // Get an architect user
  const userRes = await pool.query('SELECT id, username FROM users WHERE is_architect = true LIMIT 2');
  if (userRes.rows.length < 2) {
    console.error('Not enough architect users found');
    return;
  }
  const user1 = userRes.rows[0];
  const user2 = userRes.rows[1];

  console.log(`Testing with User 1: ${user1.username} (${user1.id})`);
  console.log(`Testing with User 2: ${user2.username} (${user2.id})`);

  // Clear previous votes for this proposal if any (cleanup)
  await pool.query('DELETE FROM tribal_votes WHERE proposal_id = $1', [proposalId]);

  // --- 1. Cast Vote for User 1 ---
  console.log('\n--- Casting Vote for User 1 (Option A) ---');
  await pool.query(
    'INSERT INTO tribal_votes (proposal_id, user_id, option_id, weight) VALUES ($1, $2, $3, $4)',
    [proposalId, user1.id, 'A', 5.0]
  );
  
  // --- 2. Cast Vote for User 2 (Option B) ---
  console.log('--- Casting Vote for User 2 (Option B) ---');
  await pool.query(
    'INSERT INTO tribal_votes (proposal_id, user_id, option_id, weight) VALUES ($1, $2, $3, $4)',
    [proposalId, user2.id, 'B', 5.0]
  );

  // --- 3. Update Vote for User 1 (Option C) ---
  console.log('--- Updating Vote for User 1 to Option C ---');
  await pool.query(
    `INSERT INTO tribal_votes (proposal_id, user_id, option_id, weight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (proposal_id, user_id) 
     DO UPDATE SET option_id = EXCLUDED.option_id`,
    [proposalId, user1.id, 'C', 5.0]
  );

  // --- 4. Verify Results ---
  console.log('\n--- Verifying Results ---');
  const results = await pool.query(
    'SELECT option_id, SUM(weight) as total_weight, COUNT(*) as vote_count FROM tribal_votes WHERE proposal_id = $1 GROUP BY option_id',
    [proposalId]
  );
  console.log('Results in DB:', JSON.stringify(results.rows, null, 2));

  const totalWeight = results.rows.reduce((sum, r) => sum + parseFloat(r.total_weight), 0);
  console.log(`Total Weight: ${totalWeight} (Expected: 10.0)`);
  
  const optionC = results.rows.find(r => r.option_id === 'C');
  const optionB = results.rows.find(r => r.option_id === 'B');
  const optionA = results.rows.find(r => r.option_id === 'A');

  if (optionC && parseFloat(optionC.total_weight) === 5.0 && parseInt(optionC.vote_count) === 1 &&
      optionB && parseFloat(optionB.total_weight) === 5.0 && parseInt(optionB.vote_count) === 1 &&
      !optionA) {
    console.log('\nSUCCESS: Voting logic verified correctly (Weights applied, conflicts handled).');
  } else {
    console.error('\nFAILURE: Results do not match expectations.');
  }

  await pool.end();
}

testSenateVoting();
