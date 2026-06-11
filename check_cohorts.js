import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;

async function checkCohorts() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  });

  try {
    const res = await pool.query('SELECT cohort, count(*) FROM users GROUP BY cohort');
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCohorts();
