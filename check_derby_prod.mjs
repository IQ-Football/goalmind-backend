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
  console.log('--- Derby Windows Check ---');
  
  try {
    const res = await pool.query('SELECT * FROM derby_windows');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error('Error fetching derby_windows:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
