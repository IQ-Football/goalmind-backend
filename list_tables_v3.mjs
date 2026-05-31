import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool(config.database);

async function run() {
  const res = await pool.query("SELECT table_name, table_schema FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')");
  console.log(res.rows);
  await pool.end();
}
run().catch(console.error);
