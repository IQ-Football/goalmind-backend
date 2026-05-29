import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';

async function run() {
  try {
    await pool.query(
      `UPDATE achievements 
       SET description = $1, 
           criteria = criteria || '{"threshold": 10}'::jsonb
       WHERE id = $2`,
      ['Permanent exclusive status badge for the first 10 founding fans of each tribe.', FOUNDING_GENERAL_ID]
    );
    console.log('✅ Updated Founding General badge metadata.');
  } catch (err) {
    console.error('❌ Error updating badge metadata:', err.message);
  } finally {
    await pool.end();
  }
}

run();
