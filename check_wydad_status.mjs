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
  console.log('--- Wydad Casablanca Status Check ---');
  
  try {
    const tribeRes = await pool.query('SELECT id, name, member_count FROM tribes WHERE name = $1', ['Wydad Casablanca']);
    if (tribeRes.rows.length === 0) {
      console.log('Wydad Casablanca not found.');
    } else {
      const tribeData = tribeRes.rows[0];
      const actualCountRes = await pool.query('SELECT COUNT(*)::int as count FROM users WHERE tribe_id = $1', [tribeData.id]);
      const actualCount = actualCountRes.rows[0].count;
      
      console.log(`Wydad Casablanca:`);
      console.log(`  - member_count (cached): ${tribeData.member_count}`);
      console.log(`  - Actual users in DB:    ${actualCount}`);
    }
  } catch (e) {
    console.error('Error fetching data:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
