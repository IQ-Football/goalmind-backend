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

async function check() {
  const result = await pool.query('SELECT COUNT(*) as count FROM users');
  console.log('Total Signups:', result.rows[0].count);
  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });
