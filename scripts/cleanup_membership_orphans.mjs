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
  console.log('Starting Tribe Membership Orphan Cleanup...');
  
  try {
    // 1. Find users who have a tribe_id but no tribe_members record
    const orphansRes = await pool.query(`
      SELECT id, tribe_id, created_at 
      FROM users 
      WHERE tribe_id IS NOT NULL 
      AND id NOT IN (SELECT user_id FROM tribe_members)
    `);
    
    const orphans = orphansRes.rows;
    console.log(`Found ${orphans.length} orphaned memberships.`);
    
    if (orphans.length === 0) {
      console.log('No orphans found. System is clean.');
      return;
    }
    
    let fixed = 0;
    // 2. Create tribe_members records for them
    for (const orphan of orphans) {
      await pool.query(`
        INSERT INTO tribe_members (user_id, tribe_id, joined_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO NOTHING
      `, [orphan.id, orphan.tribe_id, orphan.created_at]);
      fixed++;
      if (fixed % 500 === 0) {
        console.log(`  Processed ${fixed}/${orphans.length}...`);
      }
    }
    
    console.log(`Successfully restored ${fixed} tribe membership records.`);
    
    // 3. Final verification
    const remainingRes = await pool.query(`
      SELECT count(*) 
      FROM users 
      WHERE tribe_id IS NOT NULL 
      AND id NOT IN (SELECT user_id FROM tribe_members)
    `);
    console.log(`Remaining orphans: ${remainingRes.rows[0].count}`);
    
  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    await pool.end();
  }
}

run();
