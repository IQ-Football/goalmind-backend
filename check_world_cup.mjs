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
  console.log('--- World Cup Tables Check ---');
  
  try {
    const res = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname != 'pg_catalog' AND schemaname != 'information_schema'");
    console.log('Tables:', res.rows.map(r => r.tablename).filter(t => t.toLowerCase().includes('world') || t.toLowerCase().includes('cup') || t.toLowerCase().includes('tournament')));
    
    // Check specific tournament engagement if tables exist
    const tournamentTables = ['tournaments', 'tournament_participants', 'world_cup_brackets'];
    for (const table of tournamentTables) {
        try {
            const countRes = await pool.query(`SELECT COUNT(*) FROM ${table}`);
            console.log(`${table} count: ${countRes.rows[0].count}`);
        } catch (e) {
            // Table might not exist
        }
    }
  } catch (e) {
    console.error('Error fetching tables:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
