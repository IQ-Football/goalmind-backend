const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres'
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding missing columns to users table...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS gems INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS pro_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS battle_tokens INTEGER DEFAULT 5,
      ADD COLUMN IF NOT EXISTS last_token_refill_at TIMESTAMPTZ DEFAULT NOW();
    `);
    console.log('Columns added successfully.');

    // Also ensure gem_transactions table exists if it doesn't (though I saw it earlier)
    await client.query(`
      CREATE TABLE IF NOT EXISTS gem_transactions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id),
        amount          INTEGER NOT NULL,
        currency        VARCHAR(10),
        provider        VARCHAR(20),
        reference       VARCHAR(100),
        type            VARCHAR(20),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('gem_transactions table verified.');

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
