import pg from 'pg';
import config from './src/config.js';
const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  try {
    console.log('Adding missing indexes for performance...');
    
    // Index for referral code lookup on users - changed to non-unique due to existing duplicates
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)');
    console.log('Created idx_users_referral_code');
    
    // Index for referral attribution on users
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by)');
    console.log('Created idx_users_referred_by');
    
    // Index for tribe membership lookups
    await pool.query('CREATE INDEX IF NOT EXISTS idx_tribe_members_tribe_id ON tribe_members(tribe_id)');
    console.log('Created idx_tribe_members_tribe_id');
    
    console.log('All indexes added successfully.');
  } catch (err) {
    console.error('Failed to add indexes:', err.message);
  } finally {
    await pool.end();
  }
}

run();
