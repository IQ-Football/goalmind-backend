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
    const res = await pool.query('SELECT COUNT(*) FROM users');
    console.log(`Current Signup Count: ${res.rows[0].count}`);
  } catch (e) {
    console.error('Error fetching user count:', e.message);
  }
  await pool.end();
}

run().catch(console.error);
