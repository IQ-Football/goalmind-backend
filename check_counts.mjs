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

async function run() {
  const res = await pool.query("SELECT COUNT(*) FROM users");
  console.log(`Total users: ${res.rows[0].count}`);
  
  const achievements = await pool.query("SELECT a.name, a.id, COUNT(ua.user_id) as count FROM achievements a LEFT JOIN user_achievements ua ON a.id = ua.achievement_id GROUP BY a.name, a.id ORDER BY count DESC");
  console.table(achievements.rows);

  await pool.end();
}
run().catch(console.error);
