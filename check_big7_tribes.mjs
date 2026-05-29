
import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

const big7Names = [
  'Al Ahly',
  'Zamalek',
  'Kaizer Chiefs',
  'Orlando Pirates',
  'Raja Casablanca',
  'Wydad Casablanca',
  'Mamelodi Sundowns'
];

async function main() {
  try {
    const res = await pool.query("SELECT id, name, slug FROM tribes WHERE name ILIKE '%Zamalek%'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
