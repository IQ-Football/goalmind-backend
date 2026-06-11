import Fastify from 'fastify';
import dbPlugin from './src/plugins/db.js';
import shopService from './src/services/shopService.js';
import { FOUNDING_PRO_ID } from './src/services/achievementService.js';

const fastify = Fastify({ logger: false });

async function testShop() {
  await fastify.register(dbPlugin);
  await fastify.ready();

  const userId = '550e8400-e29b-41d4-a716-446655440000'; // Existing user from seed probably, or I can get one
  
  // Get a real user ID
  const userRes = await fastify.db.query('SELECT id FROM users LIMIT 1');
  if (userRes.rows.length === 0) {
    console.error('No users found');
    process.exit(1);
  }
  const testUserId = userRes.rows[0].id;

  console.log(`Testing purchase for user: ${testUserId}`);

  try {
    const result = await shopService.purchaseProduct(fastify, {
      userId: testUserId,
      productId: 'bp_season_1',
      provider: 'test'
    });

    console.log('Purchase Result:', JSON.stringify(result, null, 2));

    // Verify user status
    const verifyRes = await fastify.db.query(
      'SELECT is_pro, goal_tokens, metadata FROM users WHERE id = $1',
      [testUserId]
    );
    console.log('User Status After:', JSON.stringify(verifyRes.rows[0], null, 2));

    // Verify badge
    const badgeRes = await fastify.db.query(
      'SELECT * FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [testUserId, FOUNDING_PRO_ID]
    );
    console.log('Badge Awarded:', badgeRes.rows.length > 0 ? 'YES' : 'NO');

    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

testShop();
