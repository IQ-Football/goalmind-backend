import pg from 'pg';
import Redis from 'ioredis';
import config from '../src/config.js';
import { distributePrizes } from '../src/services/imperialConflictService.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password
});

async function setupTestData() {
  console.log('Setting up test data...');
  
  // Clear existing giza keys
  const keys = await redis.keys('giza:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  // Get Zamalek SC and some users
  const tribeRes = await pool.query('SELECT id FROM tribes WHERE name = \'Zamalek SC\'');
  const tribeId = tribeRes.rows[0].id;
  
  const userRes = await pool.query('SELECT id FROM users LIMIT 60');
  const users = userRes.rows.map(r => r.id);

  // Assign these users to Zamalek for the test
  await pool.query('UPDATE users SET tribe_id = $1 WHERE id = ANY($2)', [tribeId, users]);

  // 1. Setup individual wins for Top 50
  for (let i = 0; i < 60; i++) {
    const userId = users[i];
    const wins = 100 - i;
    await redis.zadd('giza:leaderboard:wins', wins, userId);
    await redis.hset('giza:user:wins', userId, wins);
  }

  // 2. Setup sector dominance for Zamalek
  const sectors = [
    'Solar Boat Museum', 'Workers Village', 'Valley Temple', 'Mastaba Field',
    'Camel Trail', 'Panorama Point', 'Giza Gateway', 'Causeway',
    'Great Pyramid', 'Sphinx', 'Pyramid of Khafre', 'Pyramid of Menkaure'
  ];

  for (const sector of sectors) {
    const dominanceKey = `giza:sector:${sector}:dominance`;
    await redis.hset(dominanceKey, tribeId, 100);
  }

  console.log('Test data setup complete.');
  return { users, tribeId };
}

async function verify(testData) {
  console.log('Verifying distribution...');
  
  const topUser = testData.users[0];
  
  // 1. Check Badge
  const badgeRes = await pool.query(
    'SELECT * FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = $1 AND b.slug = $2',
    [topUser, 'badge_gen_zamalek']
  );
  console.log('Top User Badge awarded:', badgeRes.rows.length > 0);

  // 2. Check Frame
  const frameRes = await pool.query(
    'SELECT * FROM user_collectibles WHERE user_id = $1 AND collectible_id = $2',
    [topUser, 'frame_imp_zamalek']
  );
  console.log('Top User Frame awarded:', frameRes.rows.length > 0);

  // 3. Check GT
  const userRes = await pool.query('SELECT goal_tokens FROM users WHERE id = $1', [topUser]);
  console.log(`Top User GoalTokens: ${userRes.rows[0].goal_tokens}`);
}

async function run() {
  const fastify = {
    db: pool,
    redis: redis,
    log: console
  };

  try {
    const testData = await setupTestData();
    
    // Initial State Check
    // ...
    
    console.log('Starting prize distribution...');
    const result = await distributePrizes(fastify);
    console.log('Result:', result);

    await verify(testData);

    // Cleanup
    console.log('Cleaning up test data...');
    await pool.query('DELETE FROM user_badges WHERE badge_id IN (SELECT id FROM badges WHERE slug = \'badge_gen_zamalek\')');
    await pool.query('DELETE FROM user_collectibles WHERE collectible_id = \'frame_imp_zamalek\'');
    // Note: Didn't reset GT but this is a dry-run/test.

  } catch (err) {
    console.error('Error during dry-run:', err);
  } finally {
    await pool.end();
    redis.disconnect();
  }
}

run();
