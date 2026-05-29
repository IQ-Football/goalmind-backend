import pg from 'pg';
import config from '../src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

const ETERNAL_TITAN_ID = '550e8400-e29b-41d4-a716-446655440007';

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Adding Eternal Titan badge...');
    
    await client.query(\`
      INSERT INTO achievements (id, name, description, slug, tier, criteria)
      VALUES 
        ($1, 'Eternal Titan', 'Awarded to the legendary first 5,000 users of GoalMind.', 'eternal_titan', 'Legendary', '{"type": "early_signup", "limit": 5000}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    \`, [ETERNAL_TITAN_ID]);

    console.log('Auto-awarding Eternal Titan to first 5000 users...');
    
    await client.query(\`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, created_at
      FROM (
        SELECT id, created_at
        FROM users
        ORDER BY created_at ASC
        LIMIT 5000
      ) as first_users
      ON CONFLICT (user_id, achievement_id) DO NOTHING;
    \`, [ETERNAL_TITAN_ID]);

    console.log('Adding anthem_url to tribes...');
    await client.query(\`
      ALTER TABLE tribes ADD COLUMN IF NOT EXISTS anthem_url TEXT;
      ALTER TABLE tribes ADD COLUMN IF NOT EXISTS has_anthem_multiplier BOOLEAN DEFAULT false;
    \`);

    await client.query('COMMIT');
    console.log('Migration complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
