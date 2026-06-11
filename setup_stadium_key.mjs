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

const STADIUM_KEY_ID = '880e8400-e29b-41d4-a716-446655440001';

async function setup() {
  try {
    console.log('Setting up Stadium Key achievement...');
    await pool.query(`
      INSERT INTO achievements (id, name, description, badge_url, criteria, tier, slug)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET 
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        badge_url = EXCLUDED.badge_url,
        criteria = EXCLUDED.criteria,
        tier = EXCLUDED.tier,
        slug = EXCLUDED.slug
    `, [
      STADIUM_KEY_ID,
      'Stadium Key',
      'The unique digital relic awarded to the 25,000th user. A symbol of total tribe dominance.',
      '/assets/badges/stadium_key.png',
      JSON.stringify({ type: 'milestone', exact: 25000 }),
      'relic',
      'stadium-key'
    ]);

    // Get 25,000th user
    const userRes = await pool.query('SELECT id, username FROM users ORDER BY created_at ASC LIMIT 1 OFFSET 24999');
    const user = userRes.rows[0];

    if (user) {
      console.log(`Awarding Stadium Key to 25,000th user: ${user.username} (${user.id})`);
      await pool.query(
        'INSERT INTO user_achievements (user_id, achievement_id, earned_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
        [user.id, STADIUM_KEY_ID]
      );
      
      // Update metadata
      const badgeData = {
        asset: '/assets/badges/stadium_key.png',
        name: 'Stadium Key',
        flair_name: 'The Great Gatekeeper'
      };

      await pool.query(`
        UPDATE users
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('badges', COALESCE(metadata->'badges', '{}'::jsonb) || jsonb_build_object('stadium_key', $1::jsonb))
        WHERE id = $2
      `, [JSON.stringify(badgeData), user.id]);

      console.log('Stadium Key awarded successfully.');
    } else {
      console.log('25,000th user not found.');
    }

  } catch (err) {
    console.error('Error setting up Stadium Key:', err);
  } finally {
    await pool.end();
  }
}

setup();
