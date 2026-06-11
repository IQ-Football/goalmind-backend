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

    console.log('Creating index for guest_sessions(expires_at)...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at ON guest_sessions(expires_at);
    `);

    console.log('Creating index for users(legacy_xp DESC)...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_legacy_xp ON users(legacy_xp DESC);
    `);
    
    console.log('Creating index for guest_sessions(session_id)...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_guest_sessions_session_id ON guest_sessions(session_id);
    `);

    await client.query('COMMIT');
    console.log('Migration 021 complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration 021 failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
