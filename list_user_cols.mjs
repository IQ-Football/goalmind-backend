import config from './src/config.js';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool(config.database);

async function run() {
  const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position");
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}
run();
