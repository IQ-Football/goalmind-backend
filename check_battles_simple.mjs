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
  console.log('--- Battles Count Check ---');
  
  try {
    const res = await pool.query(`
      SELECT COUNT(*) FROM battles WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);
    console.log('Battles in last 24 hours:', res.rows[0].count);
    
    if (parseInt(res.rows[0].count) > 0) {
        const latest = await pool.query(`
          SELECT * FROM battles ORDER BY created_at DESC LIMIT 5
        `);
        console.log('Latest Battles:');
        console.table(latest.rows);
    }
  } catch (e) {
    console.error('Error fetching battles:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
