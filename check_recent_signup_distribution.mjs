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
    const res = await pool.query(`
      SELECT t.name, COUNT(u.id) as recent_signups
      FROM users u
      JOIN tribes t ON u.tribe_id = t.id
      WHERE u.created_at >= '2026-06-05'
      GROUP BY t.name
      ORDER BY recent_signups DESC
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
