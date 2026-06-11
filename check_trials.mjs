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
  console.log('--- Guest Sessions & Trial Battles Check ---');
  
  try {
    const res = await pool.query(`
      SELECT COUNT(*) FROM guest_sessions
    `);
    console.log('Total Guest Sessions:', res.rows[0].count);
    
    if (parseInt(res.rows[0].count) > 0) {
        const latest = await pool.query(`
          SELECT * FROM guest_sessions ORDER BY created_at DESC LIMIT 5
        `);
        console.log('Latest Guest Sessions:');
        console.table(latest.rows);
        
        const completedTrials = await pool.query(`
          SELECT COUNT(*) FROM guest_sessions WHERE battle_results IS NOT NULL
        `);
        console.log('Completed Trial Battles:', completedTrials.rows[0].count);
    }
  } catch (e) {
    console.error('Error fetching guest sessions:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
