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
    const res = await pool.query("SELECT COUNT(*) FROM referrals WHERE created_at >= '2026-05-18'");
    console.log(`Referrals since May 18: ${res.rows[0].count}`);
    
    const latest = await pool.query("SELECT created_at FROM referrals ORDER BY created_at DESC LIMIT 5");
    console.log("Latest referrals:", JSON.stringify(latest.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
