import pg from 'pg';
import config from '../src/config.js';

export async function up() {
  const pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name
  });

  const client = await pool.connect();
  try {
    console.log('Updating users_role_check constraint to include "guest"...');
    await client.query('BEGIN');
    
    // Drop existing constraint
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    
    // Add new constraint with 'guest' role
    await client.query(`
      ALTER TABLE users 
      ADD CONSTRAINT users_role_check 
      CHECK (role::text = ANY (ARRAY['user', 'admin', 'moderator', 'guest']::text[]))
    `);

    console.log('Updating referrals_source_check constraint...');
    // Drop existing constraint
    await client.query('ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_source_check');
    
    // Add new constraint with more sources
    await client.query(`
      ALTER TABLE referrals 
      ADD CONSTRAINT referrals_source_check 
      CHECK (source::text = ANY (ARRAY['whatsapp', 'instagram', 'twitter', 'tiktok', 'discord', 'direct', 'other', 'web_register', 'phone_signup', 'ghost_conversion']::text[]))
    `);
    
    await client.query('COMMIT');
    console.log('Constraint updated successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to update constraint:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

up().catch(err => {
  console.error(err);
  process.exit(1);
});
