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

async function verifyConsistency() {
  const client = await pool.connect();
  try {
    console.log('--- Database Consistency Check ---');
    
    // 1. Total User Count
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    console.log(`Total users: ${userCount.rows[0].count}`);
    
    // 2. Tribe Assignment Consistency
    const usersWithoutTribe = await client.query('SELECT COUNT(*) FROM users WHERE tribe_id IS NULL AND role != \'admin\'');
    console.log(`Users without tribe (excluding admins): ${usersWithoutTribe.rows[0].count}`);
    
    // 3. Tribe Members Table Consistency
    const tribeMembersCount = await client.query('SELECT COUNT(*) FROM tribe_members');
    console.log(`Total tribe_members entries: ${tribeMembersCount.rows[0].count}`);
    
    const mismatchedTribes = await client.query(`
      SELECT COUNT(*) 
      FROM users u
      LEFT JOIN tribe_members tm ON u.id = tm.user_id
      WHERE u.tribe_id IS NOT NULL 
      AND (tm.tribe_id IS NULL OR tm.tribe_id != u.tribe_id)
    `);
    console.log(`Mismatched tribe_id between 'users' and 'tribe_members': ${mismatchedTribes.rows[0].count}`);

    // 4. Check for orphaned tribe_members (entries with no corresponding user)
    const orphanedTribeMembers = await client.query(`
      SELECT COUNT(*)
      FROM tribe_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE u.id IS NULL
    `);
    console.log(`Orphaned tribe_members entries (no user): ${orphanedTribeMembers.rows[0].count}`);

    // 5. Centurion Surge Check (Signup numbers)
    const maxSignupNumber = await client.query('SELECT MAX((metadata->>\'signup_number\')::int) as max_signup FROM users WHERE metadata->>\'signup_number\' IS NOT NULL');
    console.log(`Max signup number in metadata: ${maxSignupNumber.rows[0].max_signup}`);

  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

verifyConsistency();
