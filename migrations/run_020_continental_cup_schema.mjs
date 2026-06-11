
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
    console.log('Running migration: 020_continental_cup_schema');
    
    await client.query('BEGIN');

    // 1. Continental Cup Seasons
    await client.query(`
      CREATE TABLE IF NOT EXISTS continental_cup_seasons (
        id UUID PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        start_at TIMESTAMP WITH TIME ZONE NOT NULL,
        end_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // 2. Continental Cup Tribe Rankings
    await client.query(`
      CREATE TABLE IF NOT EXISTS continental_cup_tribe_rankings (
        id UUID PRIMARY KEY,
        season_id UUID NOT NULL REFERENCES continental_cup_seasons(id),
        tribe_id UUID NOT NULL REFERENCES tribes(id),
        total_wins INTEGER DEFAULT 0,
        active_members INTEGER DEFAULT 0,
        avg_iq NUMERIC(10, 2) DEFAULT 0,
        market_multiplier NUMERIC(10, 4) DEFAULT 1.0,
        tpi NUMERIC(10, 4) DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(season_id, tribe_id)
      )
    `);

    // 3. Bounty Challenges
    await client.query(`
      CREATE TABLE IF NOT EXISTS bounty_challenges (
        id UUID PRIMARY KEY,
        season_id UUID NOT NULL REFERENCES continental_cup_seasons(id),
        challenger_id UUID NOT NULL REFERENCES users(id),
        challenged_id UUID NOT NULL REFERENCES users(id),
        battle_id UUID REFERENCES battles(id),
        status VARCHAR(20) DEFAULT 'pending',
        winner_id UUID REFERENCES users(id),
        points_awarded INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE
      )
    `);

    // Indices for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bounty_challenges_battle ON bounty_challenges(battle_id);
      CREATE INDEX IF NOT EXISTS idx_cup_rankings_tpi ON continental_cup_tribe_rankings(season_id, tpi DESC);
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
