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
  try {
    const res = await pool.query("SELECT id, name FROM tribes WHERE name = 'Al Ahly'");
    const tribeId = res.rows[0].id;
    console.log(`Al Ahly Tribe ID: ${tribeId}`);
    
    const captains = await pool.query("SELECT id, handle FROM users WHERE tribe_id = $1 AND role = 'captain'", [tribeId]);
    console.log(`Captains found: ${captains.rows.length}`);
    console.table(captains.rows);

  } catch (e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}

run().catch(console.error);
