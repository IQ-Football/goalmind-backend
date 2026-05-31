import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool(config.database);

async function run() {
  const res = await pool.query("SELECT schema_name FROM information_schema.schemata");
  console.log(res.rows);
  await pool.end();
}
run().catch(console.error);
