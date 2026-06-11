import pg from 'pg';
import Redis from 'ioredis';
import config from './src/config.js';

const pool = new pg.Pool({
  ...config.database,
  database: config.database.name
});

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
});

async function sync() {
  console.log('🔄 Syncing Redis counters with Database...');

  try {
    // 1. users:total_count
    const userCountRes = await pool.query('SELECT COUNT(*)::int as count FROM users');
    const userCount = userCountRes.rows[0].count;
    await redis.set('users:total_count', userCount);
    console.log(`✅ users:total_count synced to ${userCount}`);

    // 2. tribe:*:member_count
    const tribesRes = await pool.query('SELECT id, member_count FROM tribes');
    for (const tribe of tribesRes.rows) {
        await redis.set(`tribe:${tribe.id}:member_count`, tribe.member_count);
    }
    console.log(`✅ tribe member counts synced for ${tribesRes.rows.length} tribes`);

    // Add more counters here if needed

    console.log('🚀 Sync complete.');
  } catch (err) {
    console.error('❌ Sync failed:', err);
  } finally {
    await pool.end();
    redis.disconnect();
  }
}

sync();
