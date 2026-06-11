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
  console.log('--- Continental Cup Tribe Rankings ---');
  
  try {
    const res = await pool.query(`
      SELECT t.name, r.points, r.wins, r.losses 
      FROM continental_cup_tribe_rankings r
      JOIN tribes t ON r.tribe_id = t.id
      ORDER BY r.points DESC
      LIMIT 10
    `);
    console.table(res.rows);
  } catch (e) {
    console.error('Error fetching rankings:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
