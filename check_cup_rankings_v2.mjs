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
  console.log('--- Continental Cup Tribe Rankings (Corrected) ---');
  
  try {
    const res = await pool.query(`
      SELECT t.name, r.total_wins, r.active_members, r.avg_iq, r.tpi
      FROM continental_cup_tribe_rankings r
      JOIN tribes t ON r.tribe_id = t.id
      ORDER BY r.tpi DESC
      LIMIT 10
    `);
    console.table(res.rows);
    
    const totals = await pool.query(`
      SELECT SUM(total_wins) as total_wins, SUM(active_members) as total_active_participants
      FROM continental_cup_tribe_rankings
    `);
    console.log('Total Wins in Season:', totals.rows[0].total_wins);
    console.log('Total Active Participants:', totals.rows[0].total_active_participants);
    
  } catch (e) {
    console.error('Error fetching rankings:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
