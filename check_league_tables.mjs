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

async function check() {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'league%' ORDER BY table_name");
  console.log(JSON.stringify(tables.rows.map(r => r.table_name), null, 2));
  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });