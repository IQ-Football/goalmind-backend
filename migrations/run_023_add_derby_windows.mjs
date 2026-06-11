
import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Creating derby_windows table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS derby_windows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(100) NOT NULL,
          start_time TIMESTAMP WITH TIME ZONE NOT NULL,
          end_time TIMESTAMP WITH TIME ZONE NOT NULL,
          tribe_ids UUID[] DEFAULT '{}',
          multipliers JSONB DEFAULT '{
              "goal_tokens": 2,
              "tribe_honor": 3,
              "founding_recruiter_bounty": 2
          }',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_derby_windows_time ON derby_windows(start_time, end_time);
    `);
    console.log('Table created successfully.');
  } catch (err) {
    console.error('Error creating table:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
