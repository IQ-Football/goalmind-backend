import Redis from 'ioredis';
import pkg from 'pg';
const { Client } = pkg;

async function init() {
  const redis = new Redis();
  const pgClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'goalmind',
    user: 'postgres',
    password: 'postgres',
  });
  await pgClient.connect();
  const res = await pgClient.query('SELECT COUNT(*) FROM users');
  const count = parseInt(res.rows[0].count);
  await redis.set('stats:total_signups', count);
  console.log('stats:total_signups initialized to', count);
  await pgClient.end();
  await redis.quit();
}
init().catch(console.error);
