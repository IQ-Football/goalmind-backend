
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

async function run() {
  try {
    const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';
    const res = await pool.query(`
      SELECT ua.user_id, ua.achievement_id, ua.earned_at, u.username, u.metadata as user_metadata, u.tribe_id
      FROM user_achievements ua
      JOIN users u ON ua.user_id = u.id
      WHERE ua.achievement_id = $1
    `, [FOUNDING_GENERAL_ID]);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
