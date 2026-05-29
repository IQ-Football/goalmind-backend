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
  const result = await pool.query(`
    SELECT u.email, a.name
    FROM user_achievements ua 
    JOIN users u ON ua.user_id = u.id 
    JOIN achievements a ON ua.achievement_id = a.id 
    WHERE u.tribe_id = (SELECT id FROM tribes WHERE slug = 'al-ahly')
    AND a.name = 'Founding General'
  `);
  console.log('Al Ahly Founding Generals:', JSON.stringify(result.rows, null, 2));
  console.log('Total:', result.rows.length);
  
  if (result.rows.length > 0) {
    const raw = await pool.query("SELECT * FROM user_achievements LIMIT 1");
    console.log('Raw row sample:', raw.rows[0]);
  }

  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });
