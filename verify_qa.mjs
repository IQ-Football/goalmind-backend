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
  try {
    const res = await pool.query('SELECT id, username, email, tribe_id, referral_code, nation_points FROM users WHERE email = $1', ['qa_verify_final@goalmind.app']);
    console.log('USER_CHECK_RESULT:');
    console.log(JSON.stringify(res.rows, null, 2));

    if (res.rows.length > 0) {
        const userId = res.rows[0].id;
        const achievements = await pool.query('SELECT a.name FROM achievements a JOIN user_achievements ua ON a.id = ua.achievement_id WHERE ua.user_id = $1', [userId]);
        console.log('ACHIEVEMENTS_CHECK_RESULT:');
        console.log(JSON.stringify(achievements.rows, null, 2));
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
