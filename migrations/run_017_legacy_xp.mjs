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

    console.log('Adding legacy_xp and arena_level to users...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_xp INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_level INTEGER DEFAULT 1;
    `);

    console.log('Creating index on arena_level...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_arena_level ON users(arena_level DESC);
    `);

    // Backfill from metadata if any exists
    console.log('Backfilling from metadata...');
    await client.query(`
      UPDATE users 
      SET legacy_xp = COALESCE((metadata->>'legacy_xp')::int, 0),
          arena_level = COALESCE((metadata->>'arena_level')::int, 1)
      WHERE metadata->>'legacy_xp' IS NOT NULL OR metadata->>'arena_level' IS NOT NULL;
    `);

    await client.query('COMMIT');
    console.log('Migration 017 complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration 017 failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
