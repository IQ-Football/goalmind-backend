import pg from 'pg';
import config from '../src/config.js';

import { awardFoundingGeneral, awardBadge, FOUNDING_GENERAL_ID, FOUNDING_CAPTAIN_ID } from '../src/services/achievementService.js';

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

const THRESHOLD = 10;

/**
 * Award the badge using the service layer
 */
async function awardToUserWithCap(userId, email, force = false) {
  try {
    const result = await awardFoundingGeneral(fastify, userId, force);
    
    if (result.success) {
      if (result.message === 'already_awarded') {
        console.log(`ℹ️ User ${email || userId} already has the Founding General badge.`);
        return false;
      }
      console.log(`✅ Successfully awarded Founding General to ${email || userId}${force ? ' (FORCED)' : ''} - Signup #${result.signupNumber}`);
      return true;
    } else {
      if (result.reason === 'cap_reached') {
        console.warn(`⚠️ Tribe cap reached (${result.count}/10) for ${email || userId}'s tribe. Awarding 'Founding Captain' instead? (Use --captain)`);
        console.log(`ℹ️ Use --force to override cap.`);
      } else {
        console.error(`❌ Failed to award to ${email || userId}: ${result.reason}`);
      }
      return false;
    }
  } catch (err) {
    console.error(`❌ Error awarding to ${email || userId}:`, err.message);
    return false;
  }
}

async function awardCaptain(userId, email) {
  try {
    const success = await awardBadge(fastify, userId, FOUNDING_CAPTAIN_ID);
    if (success) {
      console.log(`✅ Awarded Founding Captain to ${email || userId}`);
      return true;
    } else {
      console.log(`ℹ️ User ${email || userId} already has the Founding Captain badge.`);
      return false;
    }
  } catch (err) {
    console.error(`❌ Error awarding Captain to ${email || userId}:`, err.message);
    return false;
  }
}

async function syncTribe(tribeId, tribeName) {
  console.log(`\nSyncing tribe: ${tribeName} (${tribeId})...`);
  const users = await pool.query(
    `SELECT id, email, created_at FROM users 
     WHERE tribe_id = $1 
     ORDER BY created_at ASC 
     LIMIT $2`,
    [tribeId, THRESHOLD]
  );

  console.log(`Found ${users.rows.length} qualifying users.`);
  let awarded = 0;
  for (const user of users.rows) {
    const success = await awardToUserWithCap(user.id, user.email);
    if (success) awarded++;
  }
  console.log(`Finished tribe ${tribeName}. New awards: ${awarded}`);
}

async function run() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filteredArgs = args.filter(a => a !== '--force');
  const mode = filteredArgs[0];
  const value = filteredArgs[1];

  try {
    if (mode === '--email' && value) {
      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [value.toLowerCase()]);
      if (userRes.rows.length === 0) {
        console.error('User not found.');
      } else {
        await awardToUserWithCap(userRes.rows[0].id, value, force);
      }
    } else if (mode === '--user' && value) {
      const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [value]);
      if (userRes.rows.length === 0) {
        console.error('User not found.');
      } else {
        await awardToUserWithCap(userRes.rows[0].id, userRes.rows[0].email, force);
      }
    } else if (mode === '--captain' && value) {
        const userRes = await pool.query('SELECT id, email FROM users WHERE email = $1 OR id::text = $1', [value.toLowerCase()]);
        if (userRes.rows.length === 0) {
          console.error('User not found.');
        } else {
          await awardCaptain(userRes.rows[0].id, userRes.rows[0].email);
        }
    } else if (mode === '--tribe' && value) {
      const tribeRes = await pool.query(
        'SELECT id, name FROM tribes WHERE id = $1 OR slug = $2',
        [value, value]
      );
      if (tribeRes.rows.length === 0) {
        console.error('Tribe not found.');
      } else {
        await syncTribe(tribeRes.rows[0].id, tribeRes.rows[0].name);
      }
    } else if (mode === '--all') {
      const tribes = await pool.query('SELECT id, name FROM tribes WHERE is_super_tribe = true');
      for (const tribe of tribes.rows) {
        await syncTribe(tribe.id, tribe.name);
      }
    } else {
      console.log('Usage:');
      console.log('  node manual_award_founding_general.mjs --email <email> [--force]');
      console.log('  node manual_award_founding_general.mjs --user <userId> [--force]');
      console.log('  node manual_award_founding_general.mjs --captain <email_or_userId>');
      console.log('  node manual_award_founding_general.mjs --tribe <tribe_id_or_slug>');
      console.log('  node manual_award_founding_general.mjs --all');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
