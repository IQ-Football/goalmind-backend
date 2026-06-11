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
  console.log('--- Battles Table Schema ---');
  
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'battles'
    `);
    console.table(res.rows);
  } catch (e) {
    console.error('Error fetching schema:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
