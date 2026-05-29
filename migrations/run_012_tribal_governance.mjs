
import pg from 'pg';
import config from '../src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Creating tribal_proposals table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tribal_proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tribe_id UUID REFERENCES tribes(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        options JSONB NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ends_at TIMESTAMP WITH TIME ZONE
      );
    `);

    console.log('Creating tribal_votes table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tribal_votes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id UUID REFERENCES tribal_proposals(id),
        user_id UUID REFERENCES users(id),
        option_id VARCHAR(50) NOT NULL,
        weight INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(proposal_id, user_id)
      );
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
