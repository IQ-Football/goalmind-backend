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
  const res = await pool.query("SELECT table_name, table_schema FROM information_schema.tables WHERE table_schema = 'public'");
  console.log(res.rows);
  await pool.end();
}
run().catch(console.error);
