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
  // Get 25,000th user
  const userResult = await pool.query('SELECT id, username, created_at FROM users ORDER BY created_at ASC LIMIT 1 OFFSET 24999');
  const user = userResult.rows[0];
  console.log('25,000th User:', JSON.stringify(user, null, 2));

  if (user) {
    // Check their achievements
    const achResult = await pool.query('SELECT a.name FROM user_achievements ua JOIN achievements a ON ua.achievement_id = a.id WHERE ua.user_id = $1', [user.id]);
    console.log('Achievements:', achResult.rows.map(r => r.name));
    
    // Check if Stadium Key exists in achievements table
    const stadiumKeyRes = await pool.query('SELECT id FROM achievements WHERE name = $1', ['Stadium Key']);
    console.log('Stadium Key ID:', stadiumKeyRes.rows[0]?.id || 'NOT FOUND');
  }

  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });
