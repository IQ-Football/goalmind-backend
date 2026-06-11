import pg from 'pg';
import config from '../src/config.js';
import { 
  awardFoundingGeneral, 
  awardFoundingCaptain,
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

const THRESHOLD = 10;

/**
 * Award the badge using the service layer
 */
async function awardToUserWithCap(userId, email, force = false, signupNumber = null, autoCaptain = false) {
  try {
    const result = await awardFoundingGeneral(fastify, userId, force, signupNumber);
    if (result.success) {
      console.log(`✅ Successfully awarded Founding General to ${email || userId}${force ? ' (FORCED)' : ''} - Signup #${result.signupNumber}`);
      return true;
    } else {
      if (result.reason === 'already_awarded') {
        console.log(`ℹ️ User ${email || userId} already has the Founding General badge (Signup #${result.signupNumber}).`);
        return false;
      }
      
      if (result.reason === 'cap_reached') {
        console.warn(`⚠️ Tribe cap reached (${result.count}/10) for ${email || userId}'s tribe.`);
        
        if (autoCaptain) {
            console.log(`🚀 Automatically awarding Founding Captain instead...`);
            const capResult = await awardFoundingCaptain(fastify, userId, false, result.count + 1);
            if (capResult.success) {
                console.log(`✅ Successfully awarded Founding Captain to ${email || userId} - Signup #${capResult.signupNumber}`);
                return true;
            } else {
                console.error(`❌ Failed to award Founding Captain: ${capResult.reason}`);
            }
        } else {
            console.log(`ℹ️ Use --force to override cap or --auto-captain to award Captain instead.`);
        }
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
      const result = await awardFoundingCaptain(fastify, userId);
      if (result.success) {
        console.log(`✅ Successfully awarded Founding Captain to ${email || userId} - Signup #${result.signupNumber}`);
        return true;
      } else {
        console.error(`❌ Failed to award Founding Captain: ${result.reason}`);
        return false;
      }
    } catch (err) {
      console.error(`❌ Error awarding Founding Captain:`, err.message);
      return false;
    }
}

async function syncTribe(tribeId, tribeName, autoCaptain = false) {
  console.log(`Syncing Founding Generals for tribe: ${tribeName}...`);
  // Get top members of the tribe (FIFO)
  const users = await pool.query(
    `SELECT u.id, u.email
     FROM users u
     LEFT JOIN tribe_members tm ON u.id = tm.user_id
     WHERE u.tribe_id = $1
     ORDER BY COALESCE(tm.joined_at, u.created_at) ASC, u.created_at ASC
     LIMIT $2`,
    [tribeId, THRESHOLD]
  );

  console.log(`Found ${users.rows.length} qualifying users.`);
  let awarded = 0;
  for (const user of users.rows) {
    const success = await awardToUserWithCap(user.id, user.email, false, null, autoCaptain);
    if (success) awarded++;
  }
  console.log(`Finished tribe ${tribeName}. New awards: ${awarded}`);
}

async function run() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const autoCaptain = args.includes('--auto-captain');

  // Extract --number <val>
  let signupNumber = null;
  const numIndex = args.indexOf('--number');
  if (numIndex !== -1 && args[numIndex + 1]) {
    signupNumber = parseInt(args[numIndex + 1]);
  }

  const filteredArgs = args.filter(a => a !== '--force' && a !== '--auto-captain' && a !== '--number' && a !== String(signupNumber));
  
  const mode = filteredArgs[0];
  const value = filteredArgs[1];

  try {
    if (mode === '--email' && value) {
      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [value.toLowerCase()]);
      if (userRes.rows.length === 0) {
        console.error('User not found.');
      } else {
        await awardToUserWithCap(userRes.rows[0].id, value, force, signupNumber, autoCaptain);
      }
    } else if (mode === '--user' && value) {
      const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [value]);
      if (userRes.rows.length === 0) {
        console.error('User not found.');
      } else {
        await awardToUserWithCap(userRes.rows[0].id, userRes.rows[0].email, force, signupNumber, autoCaptain);
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
        await syncTribe(tribeRes.rows[0].id, tribeRes.rows[0].name, autoCaptain);
      }
    } else if (mode === '--surge') {
      const SURGE_TRIBE_SLUGS = [
        'nigeria',
        'lagos',
        'university-of-lagos',
        'ghana',
        'morocco',
        'uct-ikey-tigers',
        'wits-clever-boys'
      ];
      for (const slug of SURGE_TRIBE_SLUGS) {
        const tribeRes = await pool.query('SELECT id, name FROM tribes WHERE slug = $1', [slug]);
        if (tribeRes.rows.length > 0) {
          await syncTribe(tribeRes.rows[0].id, tribeRes.rows[0].name, autoCaptain);
        }
      }
    } else if (mode === '--bulk' && value) {
        // Bulk award from file (one ID or email per line)
        const fs = await import('fs');
        const content = fs.readFileSync(value, 'utf8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        console.log(`Starting bulk award for ${lines.length} entries...`);
        for (const line of lines) {
            const userRes = await pool.query('SELECT id, email FROM users WHERE id::text = $1 OR email = $2', [line, line.toLowerCase()]);
            if (userRes.rows.length > 0) {
                await awardToUserWithCap(userRes.rows[0].id, userRes.rows[0].email, force, null, autoCaptain);
            } else {
                console.warn(`User ${line} not found.`);
            }
        }
    } else if (mode === '--all') {
      const tribes = await pool.query('SELECT id, name FROM tribes');
      for (const tribe of tribes.rows) {
        await syncTribe(tribe.id, tribe.name, autoCaptain);
      }
    } else {
      console.log('Usage:');
      console.log('  node manual_award_founding_general.mjs --email <email> [--force] [--auto-captain] [--number <val>]');
      console.log('  node manual_award_founding_general.mjs --user <userId> [--force] [--auto-captain] [--number <val>]');
      console.log('  node manual_award_founding_general.mjs --captain <email_or_userId>');
      console.log('  node manual_award_founding_general.mjs --tribe <tribe_id_or_slug> [--auto-captain]');
      console.log('  node manual_award_founding_general.mjs --bulk <file_path> [--force] [--auto-captain]');
      console.log('  node manual_award_founding_general.mjs --surge [--auto-captain]');
      console.log('  node manual_award_founding_general.mjs --all [--auto-captain]');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
