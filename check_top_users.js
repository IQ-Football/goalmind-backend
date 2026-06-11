import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;

async function checkTopUsers() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  });

  try {
    const res = await pool.query(`
      WITH ranked_users AS (
        SELECT id, username, cohort, created_at, ROW_NUMBER() OVER (ORDER BY created_at ASC) as signup_number
        FROM users
      )
      SELECT * FROM ranked_users
      WHERE signup_number <= 10 OR (signup_number >= 495 AND signup_number <= 505) OR (signup_number >= 24995 AND signup_number <= 25005) OR signup_number >= 40000
      ORDER BY signup_number ASC
    `);
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkTopUsers();
