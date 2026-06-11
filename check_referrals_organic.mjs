import pkg from 'pg';
const { Pool } = pkg;
import config from './src/config.js';

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  try {
    const res = await pool.query("SELECT referrer_id, recruit_id, source, created_at FROM referrals WHERE created_at >= '2026-06-01' ORDER BY created_at DESC LIMIT 20");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
