import pg from 'pg';
import config from '../src/config.js';
import { convertTokensToLegacyXP, autoSinkExcessTokens } from '../src/services/legacyXPService.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

// Mock fastify object
const fastify = {
  db: pool,
  log: {
    error: console.error,
    info: console.log
  }
};

async function test() {
  const userId = '7ef20ed2-6bb4-44c5-9ce4-57589868c2a3'; // Use a known user from the scrollback
  
  console.log('Testing Legacy XP conversion for user:', userId);

  // 1. Give the user some tokens to test with
  await pool.query('UPDATE users SET goal_tokens = 6000 WHERE id = $1', [userId]);
  console.log('Set goal_tokens to 6000');

  // 2. Test manual conversion of 500 tokens
  console.log('Testing manual conversion of 500 tokens...');
  const result1 = await convertTokensToLegacyXP(fastify, userId, 500);
  console.log('Result:', JSON.stringify(result1, null, 2));

  // 3. Test auto sink for the rest (should sink 500 more to hit 5000 cap)
  console.log('Testing auto sink...');
  const result2 = await autoSinkExcessTokens(fastify, userId);
  console.log('Result:', JSON.stringify(result2, null, 2));

  // 4. Verify DB state
  const finalUser = await pool.query('SELECT goal_tokens, legacy_xp, arena_level FROM users WHERE id = $1', [userId]);
  console.log('Final DB state:', JSON.stringify(finalUser.rows[0], null, 2));

  await pool.end();
}

test().catch(console.error);
