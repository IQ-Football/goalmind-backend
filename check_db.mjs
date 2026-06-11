import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function check() {
  const client = await pool.connect();
  try {
    console.log('Checking for tables and indexes...');
    
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('users', 'tribe_members', 'tribes', 'goal_token_ledger')
    `);
    console.log('Tables:', tables.rows.map(r => r.table_name));

    // Check if goal_token_ledger has indexes
    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename IN ('users', 'goal_token_ledger', 'tribe_members')
    `);
    console.log('Existing Indexes:');
    indexes.rows.forEach(r => console.log(`- ${r.indexname}: ${r.indexdef}`));

    // Check for guest sessions - wait, where are they stored?
    // Looking at the task description, it mentions guest_sessions.
    const guestSessionsTable = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'guest_sessions'
    `);
    
    if (guestSessionsTable.rows.length > 0) {
        console.log('guest_sessions table exists.');
        const sessionCount = await client.query('SELECT COUNT(*) FROM guest_sessions');
        console.log('Total guest sessions:', sessionCount.rows[0].count);
    } else {
        console.log('guest_sessions table does NOT exist. Checking users table for guests...');
        const guestCount = await client.query("SELECT COUNT(*) FROM users WHERE role = 'guest'");
        console.log('Total guest users:', guestCount.rows[0].count);
    }

  } catch (err) {
    console.error('Check failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

check();
