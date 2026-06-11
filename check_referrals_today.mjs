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
  console.log('--- Today Referrals Check ---');
  
  try {
    const res = await pool.query("SELECT * FROM referrals WHERE created_at >= '2026-06-05T00:00:00Z'");
    console.log(`Referral records today: ${res.rows.length}`);
    if (res.rows.length > 0) {
        console.log(JSON.stringify(res.rows, null, 2));
    }
  } catch (e) {
    console.error('Error fetching referrals:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
