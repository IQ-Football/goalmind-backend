import config from './src/config.js';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  try {
    const res = await pool.query('SELECT username, created_at FROM users ORDER BY created_at DESC LIMIT 10');
    console.log('--- Last 10 Signups ---');
    console.table(res.rows);
    
    const countLastHour = await pool.query("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '1 hour'");
    console.log(`Signups in the last hour: ${countLastHour.rows[0].count}`);

  } catch (e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}

run().catch(console.error);
