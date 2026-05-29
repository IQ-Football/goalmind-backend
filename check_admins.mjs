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
  const result = await pool.query("SELECT id, username, email, role FROM users WHERE role = 'admin'");
  console.log('Admins:', JSON.stringify(result.rows, null, 2));
  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });
