
import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running migration: 019_derby_surge_windows');
    
    await client.query('BEGIN');

    // Create derby_surge_windows table
    await client.query(`
      CREATE TABLE IF NOT EXISTS derby_surge_windows (
        id UUID PRIMARY KEY,
        season_id UUID NOT NULL REFERENCES continental_cup_seasons(id),
        triggered_by_tribe_id UUID REFERENCES tribes(id),
        start_at TIMESTAMP WITH TIME ZONE NOT NULL,
        end_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Add index for performance during TPI calculation
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_derby_surge_windows_range 
      ON derby_surge_windows (start_at, end_at)
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
