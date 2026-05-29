const pg = require('pg');
const { Pool } = pg;
const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function run() {
  try {
    // Add missing columns to leagues table
    await pool.query(`
      ALTER TABLE leagues
      ADD COLUMN IF NOT EXISTS season_duration_days INTEGER DEFAULT 28,
      ADD COLUMN IF NOT EXISTS offseason_duration_days INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS current_season_start DATE,
      ADD COLUMN IF NOT EXISTS current_season_end DATE,
      ADD COLUMN IF NOT EXISTS reward_badge_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS reward_goal_tokens INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);
    console.log(' leagues columns added');

    // Create league_seasons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS league_seasons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        league_id UUID NOT NULL REFERENCES leagues(id),
        season_number INTEGER NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'upcoming',
        promoted_users JSONB DEFAULT '[]',
        relegated_users JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(league_id, season_number)
      )
    `);
    console.log(' league_seasons table created');

    // Create league_groups table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS league_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        league_id UUID NOT NULL REFERENCES leagues(id),
        season_id UUID REFERENCES league_seasons(id),
        group_number INTEGER NOT NULL,
        name VARCHAR(50) NOT NULL,
        max_size INTEGER DEFAULT 30,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(league_id, season_id, group_number)
      )
    `);
    console.log(' league_groups table created');

    // Create league_group_members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS league_group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES league_groups(id),
        user_id UUID NOT NULL REFERENCES users(id),
        participant_id UUID NOT NULL REFERENCES league_participants(id),
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(group_id, user_id)
      )
    `);
    console.log(' league_group_members table created');

    // Create league_pr_log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS league_pr_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        league_id UUID NOT NULL REFERENCES leagues(id),
        season_id UUID REFERENCES league_seasons(id),
        action VARCHAR(20) NOT NULL,
        from_group INTEGER,
        to_group INTEGER,
        from_rank INTEGER,
        to_rank INTEGER,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log(' league_pr_log table created');

    console.log('All league system tables created successfully');
  } finally {
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});