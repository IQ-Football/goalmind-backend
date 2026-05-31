import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function run() {
  const res = await pool.query("SELECT * FROM badges WHERE name LIKE '%25k%' OR name LIKE '%Surge%'");
  console.log(res.rows);
  await pool.end();
}
run().catch(console.error);
