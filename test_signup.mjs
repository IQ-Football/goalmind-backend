import pg from 'pg';
import config from './src/config.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
const { Pool } = pg;

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

const tribeId = 'fb27a4d2-79a2-43f4-8097-a8c1f517b354';
const email = 'test_debug_' + Date.now() + '@example.com';

async function run() {
  try {
    // Step 1: Check tribe
    console.log('Step 1: Check tribe...');
    const tribeResult = await pool.query('SELECT id, name, slug FROM tribes WHERE id = $1', [tribeId]);
    console.log('Tribe:', tribeResult.rows[0]);

    // Step 2: Check email
    console.log('\nStep 2: Check email...');
    const existingResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    console.log('Existing user:', existingResult.rows.length);

    // Step 3: Generate password hash
    console.log('\nStep 3: Generate password...');
    const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);
    console.log('Password hash length:', passwordHash.length);

    // Step 4: Insert user
    console.log('\nStep 4: Insert user...');
    const userResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, tribe_id, referral_code, referred_by, elo, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1000, NOW())
       RETURNING id, username, email, referral_code`,
      ['Test User', email.toLowerCase(), passwordHash, tribeId, null, null]
    );
    console.log('User created:', userResult.rows[0]);

    // Step 5: Generate referral code
    console.log('\nStep 5: Generate referral code...');
    const userId = userResult.rows[0].id;
    const referralCode = 'GM_' + tribeId.substring(0, 4) + '_' + crypto.createHash('sha256').update(`${userId}:${tribeId}:${Date.now()}`).digest('hex').substring(0, 8).toUpperCase();
    console.log('Referral code:', referralCode);

    // Step 6: Update user with referral code
    console.log('\nStep 6: Update user with referral code...');
    await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, userId]);
    console.log('Updated');

    // Step 7: Credit tribe waitlist
    console.log('\nStep 7: Credit tribe waitlist...');
    await pool.query('UPDATE tribes SET waitlist_signups = waitlist_signups + 1 WHERE id = $1', [tribeId]);
    console.log('Updated tribe waitlist');

    // Step 8: Add to tribe_members
    console.log('\nStep 8: Add to tribe_members...');
    await pool.query(
      `INSERT INTO tribe_members (user_id, tribe_id, tier, contribution_points)
       VALUES ($1, $2, 'Supporter', 1)
       ON CONFLICT (user_id, tribe_id) DO NOTHING`,
      [userId, tribeId]
    );
    console.log('Added to tribe_members');

    // Step 9: Update member_count
    console.log('\nStep 9: Update member_count...');
    await pool.query('UPDATE tribes SET member_count = member_count + 1 WHERE id = $1', [tribeId]);
    console.log('Updated member_count');

    console.log('\n✅ All steps completed successfully!');
  } catch (err) {
    console.error('\n❌ Error at:', err.message);
    console.error('Stack:', err.stack);
  } finally {
    await pool.end();
  }
}

run();