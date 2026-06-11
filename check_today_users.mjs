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
  console.log('--- Today Users Check ---');
  
  try {
    const res = await pool.query("SELECT id, username, created_at, referred_by FROM users WHERE created_at >= '2026-06-05T00:00:00Z' ORDER BY created_at DESC");
    console.log(`Users created today: ${res.rows.length}`);
    console.log(JSON.stringify(res.rows.slice(0, 5), null, 2));
    
    const referredToday = res.rows.filter(u => u.referred_by !== null);
    console.log(`Referred users today: ${referredToday.length}`);
  } catch (e) {
    console.error('Error fetching users:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
