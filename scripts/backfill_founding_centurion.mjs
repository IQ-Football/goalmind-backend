import pg from 'pg';
import config from '../src/config.js';
import { awardFoundingCenturion } from '../src/services/achievementService.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const fastify = {
  db: pool,
  log: console
};

async function backfillTribe(tribeId, tribeName) {
  console.log(`\nBackfilling tribe: ${tribeName} (${tribeId})...`);
  
  // Get users 11-100 by registration order
  const users = await pool.query(
    `SELECT id, email, created_at FROM users 
     WHERE tribe_id = $1 
     ORDER BY created_at ASC 
     OFFSET 10 
     LIMIT 90`,
    [tribeId]
  );

  console.log(`Found ${users.rows.length} qualifying users for Centurion badge.`);
  
  let awarded = 0;
  for (const user of users.rows) {
    try {
      const res = await awardFoundingCenturion(fastify, user.id, false);
      if (res.success) {
        awarded++;
      }
    } catch (err) {
      console.error(`Failed to award user ${user.email}:`, err.message);
    }
  }
  console.log(`Finished tribe ${tribeName}. New Centurion awards: ${awarded}`);
}

async function run() {
  try {
    // Get all tribes that have more than 10 members
    const tribesRes = await pool.query('SELECT id, name, member_count FROM tribes WHERE member_count > 10');
    console.log(`Found ${tribesRes.rows.length} tribes eligible for Centurion backfill.`);

    for (const tribe of tribesRes.rows) {
      await backfillTribe(tribe.id, tribe.name);
    }
    
    console.log('\n--- ALL ELIGIBLE TRIBES PROCESSED ---');
  } catch (err) {
    console.error('Backfill error:', err);
  } finally {
    await pool.end();
  }
}

run();
