import pg from 'pg';
import config from '../src/config.js';
import { awardFoundingGeneral } from '../src/services/achievementService.js';

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

async function run() {
  console.log('Starting reconciliation of zombie users...');
  
  try {
    // 1. Find users in 'users' who are missing from 'tribe_members'
    const zombieResult = await pool.query(`
      SELECT u.id, u.tribe_id, u.email
      FROM users u
      LEFT JOIN tribe_members tm ON u.id = tm.user_id
      WHERE u.tribe_id IS NOT NULL AND tm.user_id IS NULL
    `);
    
    console.log(`Found ${zombieResult.rows.length} zombie users.`);
    
    // 2. Insert them into tribe_members in batches
    let inserted = 0;
    for (let i = 0; i < zombieResult.rows.length; i += 100) {
      const batch = zombieResult.rows.slice(i, i + 100);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const user of batch) {
          await client.query(
            'INSERT INTO tribe_members (user_id, tribe_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [user.id, user.tribe_id]
          );
          inserted++;
        }
        await client.query('COMMIT');
        process.stdout.write(`\rInserted ${inserted}/${zombieResult.rows.length} users...`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('\nBatch failed:', err.message);
      } finally {
        client.release();
      }
    }
    console.log('\nFinished inserting missing tribe members.');

    // 3. Re-calculate tribe member counts
    console.log('Recalculating tribe member counts...');
    await pool.query(`
      UPDATE tribes t
      SET member_count = (
        SELECT COUNT(*) FROM tribe_members tm WHERE tm.tribe_id = t.id
      )
    `);
    console.log('Tribe member counts recalculated.');

    // 4. Award Founding General badges to qualifying users in each tribe
    console.log('Checking and awarding Founding General badges...');
    const tribes = await pool.query('SELECT id, name FROM tribes');
    
    for (const tribe of tribes.rows) {
      const topUsers = await pool.query(`
        SELECT id, email FROM users
        WHERE tribe_id = $1
        ORDER BY created_at ASC
        LIMIT 10
      `, [tribe.id]);
      
      for (const user of topUsers.rows) {
        const res = await awardFoundingGeneral(fastify, user.id);
        if (res.success && res.message !== 'already_awarded') {
          console.log(`Awarded FG to ${user.email} in tribe ${tribe.name} (Signup #${res.signupNumber})`);
        }
      }
    }
    console.log('Founding General badge awarding complete.');

  } catch (err) {
    console.error('Reconciliation failed:', err);
  } finally {
    await pool.end();
  }
}

run();
