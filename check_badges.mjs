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
  try {
    const res = await pool.query("SELECT COUNT(*) FROM user_achievements WHERE achievement_id = '550e8400-e29b-41d4-a716-446655440005'");
    console.log(`Tribe Commander Badges awarded: ${res.rows[0].count}`);
    
    const veterans = await pool.query("SELECT COUNT(*) FROM user_achievements WHERE achievement_id = '770e8400-e29b-41d4-a716-446655440004'");
    console.log(`Tribal Veteran Badges awarded: ${veterans.rows[0].count}`);

    const surge = await pool.query("SELECT COUNT(*) FROM user_achievements WHERE achievement_id = '770e8400-e29b-41d4-a716-446655440003'");
    console.log(`Centurion Surge Badges awarded: ${surge.rows[0].count}`);

  } catch (e) {
    console.error('Error fetching badge counts:', e.message);
  }
  await pool.end();
}

run().catch(console.error);
