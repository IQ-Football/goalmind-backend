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
  console.log('--- Recent Battles Check ---');
  
  try {
    const res = await pool.query(`
      SELECT battle_type, status, COUNT(*) 
      FROM battles 
      WHERE created_at >= NOW() - INTERVAL '2 days'
      GROUP BY battle_type, status
    `);
    console.table(res.rows);
    
    const latestBattles = await pool.query(`
      SELECT b.id, b.battle_type, b.status, b.created_at, t.name as tribe_name
      FROM battles b
      JOIN users u ON b.player1_id = u.id
      JOIN tribes t ON u.tribe_id = t.id
      ORDER BY b.created_at DESC
      LIMIT 5
    `);
    console.log('Latest 5 Battles:');
    console.table(latestBattles.rows);
    
  } catch (e) {
    console.error('Error fetching battles:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
