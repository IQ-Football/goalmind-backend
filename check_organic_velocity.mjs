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
    const res = await pool.query("SELECT username, created_at FROM users WHERE username NOT LIKE 'stress_%' ORDER BY created_at DESC LIMIT 10");
    console.log('--- Last 10 Organic Signups ---');
    console.table(res.rows);
    
    const count24h = await pool.query("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '24 hours' AND username NOT LIKE 'stress_%'");
    console.log(`Organic signups in the last 24 hours: ${count24h.rows[0].count}`);

  } catch (e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}

run().catch(console.error);
