import pg from 'pg';
import config from '../src/config.js';
import { 
  awardFoundingGeneral, 
  awardBadge, 
  FOUNDING_GENERAL_ID, 
  FOUNDING_CAPTAIN_ID 
} from '../src/services/achievementService.js';

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

const USAGE = `
GoalMind Manual Badge Awarding Tool
Usage:
  node award_badge_cli.mjs --email <email> [--badge <id>] [--force]
  node award_badge_cli.mjs --user <userId> [--badge <id>] [--force]
  node award_badge_cli.mjs --tribe <tribe_id_or_slug> [--badge <id>]
  node award_badge_cli.mjs --surge
  node award_badge_cli.mjs --all

Options:
  --badge <id>    Achievement ID (defaults to Founding General)
  --force         Override caps/checks
  --surge         Award Founding General to first 10 members of all surge tribes
  --all           Award Founding General to first 10 members of ALL tribes
`;

async function syncTribe(tribeId, tribeName, achievementId, force = false) {
  console.log(`\nSyncing tribe: ${tribeName} (${tribeId})...`);
  const users = await pool.query(
    `SELECT id, email FROM users 
     WHERE tribe_id = $1 
     ORDER BY created_at ASC 
     LIMIT 10`,
    [tribeId]
  );

  console.log(`Found ${users.rows.length} qualifying users.`);
  let awarded = 0;
  for (const user of users.rows) {
    const res = await awardFoundingGeneral(fastify, user.id, force);
    if (res.success) awarded++;
  }
  console.log(`Finished tribe ${tribeName}. New awards: ${awarded}`);
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const force = args.includes('--force');
  const badgeIdx = args.indexOf('--badge');
  const achievementId = badgeIdx !== -1 ? args[badgeIdx + 1] : FOUNDING_GENERAL_ID;
  
  const modeIdx = args.findIndex(a => ['--email', '--user', '--tribe', '--surge', '--all'].includes(a));
  const mode = args[modeIdx];
  const value = args[modeIdx + 1];

  try {
    if (mode === '--email' && value) {
      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [value.toLowerCase()]);
      if (userRes.rows.length === 0) {
        console.error('User not found.');
      } else {
        const userId = userRes.rows[0].id;
        if (achievementId === FOUNDING_GENERAL_ID) {
          const res = await awardFoundingGeneral(fastify, userId, force);
          console.log(res.success ? `✅ Awarded Founding General - Signup #${res.signupNumber}` : `❌ Failed: ${res.reason}`);
        } else {
          const success = await awardBadge(fastify, userId, achievementId);
          console.log(success ? '✅ Badge awarded' : 'ℹ️ User already has this badge');
        }
      }
    } else if (mode === '--user' && value) {
      if (achievementId === FOUNDING_GENERAL_ID) {
        const res = await awardFoundingGeneral(fastify, value, force);
        console.log(res.success ? `✅ Awarded Founding General - Signup #${res.signupNumber}` : `❌ Failed: ${res.reason}`);
      } else {
        const success = await awardBadge(fastify, value, achievementId);
        console.log(success ? '✅ Badge awarded' : 'ℹ️ User already has this badge');
      }
    } else if (mode === '--tribe' && value) {
      const tribeRes = await pool.query('SELECT id, name FROM tribes WHERE id = $1 OR slug = $2', [value, value]);
      if (tribeRes.rows.length === 0) {
        console.error('Tribe not found.');
      } else {
        await syncTribe(tribeRes.rows[0].id, tribeRes.rows[0].name, achievementId, force);
      }
    } else if (mode === '--surge') {
      const SURGE_TRIBE_SLUGS = ['nigeria', 'ghana', 'morocco', 'uct-ikey-tigers', 'wits-clever-boys'];
      for (const slug of SURGE_TRIBE_SLUGS) {
        const tribeRes = await pool.query('SELECT id, name FROM tribes WHERE slug = $1', [slug]);
        if (tribeRes.rows.length > 0) {
          await syncTribe(tribeRes.rows[0].id, tribeRes.rows[0].name, achievementId, force);
        }
      }
    } else if (mode === '--all') {
      const tribes = await pool.query('SELECT id, name FROM tribes');
      for (const tribe of tribes.rows) {
        await syncTribe(tribe.id, tribe.name, achievementId, force);
      }
    } else {
      console.log(USAGE);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
