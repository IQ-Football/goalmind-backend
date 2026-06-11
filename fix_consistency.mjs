import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function fixConsistency() {
  const client = await pool.connect();
  try {
    console.log('--- Fixing Database Consistency ---');
    
    // Insert missing tribe_members
    const fixResult = await client.query(`
      INSERT INTO tribe_members (user_id, tribe_id)
      SELECT u.id, u.tribe_id
      FROM users u
      LEFT JOIN tribe_members tm ON u.id = tm.user_id
      WHERE u.tribe_id IS NOT NULL AND tm.user_id IS NULL
      ON CONFLICT (user_id) DO UPDATE SET tribe_id = EXCLUDED.tribe_id
    `);
    console.log(`Inserted/Updated ${fixResult.rowCount} tribe_members entries.`);

    // Sync mismatched tribe_ids
    const syncResult = await client.query(`
      UPDATE tribe_members tm
      SET tribe_id = u.tribe_id
      FROM users u
      WHERE tm.user_id = u.id AND tm.tribe_id != u.tribe_id AND u.tribe_id IS NOT NULL
    `);
    console.log(`Synced ${syncResult.rowCount} mismatched tribe_members entries.`);

  } catch (err) {
    console.error('Fix failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

fixConsistency();
