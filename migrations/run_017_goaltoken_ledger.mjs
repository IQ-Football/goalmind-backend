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

    console.log('Creating goaltoken_ledger table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS goaltoken_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) NOT NULL,
        amount INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        reference_id UUID,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('Creating indexes for goaltoken_ledger...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_goaltoken_user ON goaltoken_ledger(user_id);
      CREATE INDEX IF NOT EXISTS idx_goaltoken_type ON goaltoken_ledger(type);
      CREATE INDEX IF NOT EXISTS idx_goaltoken_created ON goaltoken_ledger(created_at DESC);
    `);

    console.log('Ensuring goal_tokens column on users table...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_tokens INTEGER DEFAULT 0;
    `);

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
