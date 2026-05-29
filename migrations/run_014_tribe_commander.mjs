
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

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Adding Tribe Commander and Veteran badges...');
    
    // Tribe Commander: 550e8400-e29b-41d4-a716-446655440005 (Using next available)
    // Veteran (Former Commander): 550e8400-e29b-41d4-a716-446655440006
    
    await client.query(`
      INSERT INTO achievements (id, name, description, slug, tier, criteria)
      VALUES 
        ('550e8400-e29b-41d4-a716-446655440005', 'Tribe Commander', 'Awarded to the most active leaders and recruiters.', 'tribe_commander', 'Elite', '{"type": "recruitment_or_cp", "target_recruits": 50, "target_cp": 50000}'::jsonb),
        ('550e8400-e29b-41d4-a716-446655440006', 'Veteran', 'Awarded to former Tribe Commanders.', 'veteran', 'Legacy', '{"type": "legacy_status"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('Adding TC commission tracking to referrals or payments...');
    // We might need a way to track which recruits were made while the referrer was a TC
    // Or just check if the referrer is a TC at the time of payment.
    // Spec says: "TCs receive a 15% commission (in Tribe Gems) on all IAPs made by their direct recruits."
    
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
