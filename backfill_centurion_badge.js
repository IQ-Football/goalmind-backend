import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;

async function backfillCenturionSurgeBadge() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  });

  const CENTURION_SURGE_ID = '770e8400-e29b-41d4-a716-446655440003';

  try {
    console.log('Starting Centurion Surge badge backfill...');
    
    const query = `
      WITH ranked_users AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as signup_number
        FROM users
      )
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, NOW()
      FROM ranked_users
      WHERE signup_number BETWEEN 25001 AND 50000
      ON CONFLICT (user_id, achievement_id) DO NOTHING
    `;

    const res = await pool.query(query, [CENTURION_SURGE_ID]);
    console.log(`Successfully awarded badge to ${res.rowCount} users.`);
    
    await pool.end();
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
}

backfillCenturionSurgeBadge();
