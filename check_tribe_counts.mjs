import pkg from 'pg';
const { Pool } = pkg;
import config from './src/config.js';

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  try {
    const tribes = ['Zamalek SC', 'Enyimba FC', 'Al Ahly', 'Wydad Casablanca', 'Raja Casablanca'];
    const res = await pool.query("SELECT name, member_count FROM tribes WHERE name = ANY($1)", [tribes]);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
