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

    console.log('Adding vault_balance column to tribes table...');
    await client.query(`
      ALTER TABLE tribes ADD COLUMN IF NOT EXISTS vault_balance INTEGER DEFAULT 0;
    `);

    console.log('Creating tribal_vault_ledger table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tribal_vault_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tribe_id UUID REFERENCES tribes(id) NOT NULL,
        user_id UUID REFERENCES users(id),
        amount INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('Creating indexes for tribal_vault_ledger...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tribal_vault_tribe ON tribal_vault_ledger(tribe_id);
      CREATE INDEX IF NOT EXISTS idx_tribal_vault_type ON tribal_vault_ledger(type);
      CREATE INDEX IF NOT EXISTS idx_tribal_vault_created ON tribal_vault_ledger(created_at DESC);
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
