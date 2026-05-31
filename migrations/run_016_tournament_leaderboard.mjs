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

    console.log('Adding winner_tribe_id and loser_tribe_id to battles...');
    await client.query(`
      ALTER TABLE battles ADD COLUMN IF NOT EXISTS winner_tribe_id UUID REFERENCES tribes(id);
      ALTER TABLE battles ADD COLUMN IF NOT EXISTS loser_tribe_id UUID REFERENCES tribes(id);
    `);

    console.log('Creating relay_matches table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS relay_matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tribe_a_id UUID REFERENCES tribes(id),
        tribe_b_id UUID REFERENCES tribes(id),
        tribe_a_score NUMERIC DEFAULT 0,
        tribe_b_score NUMERIC DEFAULT 0,
        winner_tribe_id UUID REFERENCES tribes(id),
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('Creating indexes for optimized tournament queries...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_battles_winner_tribe ON battles(winner_tribe_id, ended_at);
      CREATE INDEX IF NOT EXISTS idx_relay_matches_winner_tribe ON relay_matches(winner_tribe_id, created_at);
    `);

    // Backfill existing completed battles with tribe IDs
    console.log('Backfilling existing battles with tribe IDs...');
    await client.query(`
      UPDATE battles b
      SET winner_tribe_id = u.tribe_id
      FROM users u
      WHERE b.winner_id = u.id AND b.winner_tribe_id IS NULL;
      
      UPDATE battles b
      SET loser_tribe_id = u.tribe_id
      FROM users u
      WHERE (b.player1_id = u.id OR b.player2_id = u.id) 
        AND b.winner_id IS NOT NULL 
        AND u.id != b.winner_id 
        AND b.loser_tribe_id IS NULL;
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
