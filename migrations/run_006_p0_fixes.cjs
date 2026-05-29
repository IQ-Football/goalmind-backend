// P0 Critical Fixes Migration
// 1. Add nation_id columns to knockout_brackets
// 2. Add role column to users
// 3. Add missing columns to wc2026_var_events for proper tracking
const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function migrate() {
  const client = await pool.connect();
  try {
    // 1. Add nation_id columns to knockout_brackets
    // These represent the actual nations competing, not users
    await client.query(`
      ALTER TABLE knockout_brackets 
      ADD COLUMN IF NOT EXISTS team1_nation_id VARCHAR(10) REFERENCES national_tribes(id),
      ADD COLUMN IF NOT EXISTS team2_nation_id VARCHAR(10) REFERENCES national_tribes(id),
      ADD COLUMN IF NOT EXISTS winner_nation_id VARCHAR(10) REFERENCES national_tribes(id);
    `);
    console.log('knockout_brackets nation_id columns OK');

    // 2. Add role column to users for admin authorization
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator'));
    `);
    console.log('users.role column OK');

    // 3. Add missing Socket.IO event tracking columns to wc2026_var_events
    // This helps track who entered which VAR battle for proper Socket.IO room validation
    await client.query(`
      ALTER TABLE wc2026_var_events
      ADD COLUMN IF NOT EXISTS total_participants INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS correct_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS incorrect_count INTEGER DEFAULT 0;
    `);
    console.log('wc2026_var_events tracking columns OK');

    // 4. Create index on knockout_brackets.nation_id for faster nation-based queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_knockout_brackets_nations 
      ON knockout_brackets(team1_nation_id, team2_nation_id, winner_nation_id);
    `);
    console.log('knockout_brackets nation indexes OK');

    // 5. Add background job tracking table for VAR cleanup and prediction validation
    await client.query(`
      CREATE TABLE IF NOT EXISTS background_jobs (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type        VARCHAR(50) NOT NULL,  -- 'var_cleanup', 'prediction_validation'
        status          VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
        scheduled_at    TIMESTAMPTZ DEFAULT NOW(),
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        records_processed INTEGER DEFAULT 0,
        last_error      TEXT,
        CONSTRAINT job_type_check CHECK (job_type IN ('var_cleanup', 'prediction_validation'))
      );
    `);
    console.log('background_jobs table OK');

    console.log('\nAll P0 fix migrations completed successfully');

  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
