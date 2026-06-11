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
    const res = await pool.query("SELECT id, name FROM achievements WHERE name ILIKE '%Commander%'");
    console.table(res.rows);
  } catch (e) {
    console.error('Error fetching achievements:', e.message);
  }
  await pool.end();
}

run().catch(console.error);
