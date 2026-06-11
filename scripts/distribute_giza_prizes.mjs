import pg from 'pg';
import Redis from 'ioredis';
import config from './src/config.js';
import { distributePrizes } from './src/services/imperialConflictService.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const redis = new Redis(config.redis.url);

async function run() {
  const fastify = {
    db: pool,
    redis: redis,
    log: console
  };

  try {
    console.log('Starting Siege of Giza prize distribution...');
    const result = await distributePrizes(fastify);
    console.log('Prize distribution complete:', result);
  } catch (err) {
    console.error('Prize distribution failed:', err);
  } finally {
    await pool.end();
    redis.disconnect();
  }
}

run();
