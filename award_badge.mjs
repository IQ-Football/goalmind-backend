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

const EMAIL = 'qa_verify_final@goalmind.app';
const ACHIEVEMENT_ID = '550e8400-e29b-41d4-a716-446655440000'; // Founding General

async function award() {
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
    if (userResult.rows.length === 0) {
      console.log('User not found');
      return;
    }
    const userId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, ACHIEVEMENT_ID]
    );

    console.log(`Badge awarded successfully to ${EMAIL}`);

    const check = await pool.query(
        `SELECT a.name FROM achievements a
         JOIN user_achievements ua ON a.id = ua.achievement_id
         WHERE ua.user_id = $1`,
        [userId]
    );
    console.log('User Achievements:', JSON.stringify(check.rows, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
award();
