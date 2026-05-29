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

// Simulate what registerWaitlistSignup does
async function simulate() {
  const tribeId = 'fb27a4d2-79a2-43f4-8097-a8c1f517b354';
  const email = 'simulate_' + Date.now() + '@test.com';

  try {
    // Steps 1-4: Check tribe, email, password, insert user
    console.log('Step 1-4...');
    const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);
    const r = await pool.query(
      `INSERT INTO users (username, email, password_hash, tribe_id, referral_code, referred_by, elo, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1000, NOW())
       RETURNING id, username, email, referral_code`,
      [email.split('@')[0], email, passwordHash, tribeId, null, null]
    );
    const user = r.rows[0];
    console.log('User:', user.id);

    // Step 5: Generate referral code
    const userReferralCode = 'GM_' + tribeId.substring(0, 4) + '_' + crypto.createHash('sha256').update(`${user.id}:${tribeId}:${Date.now()}`).digest('hex').substring(0, 8).toUpperCase();
    
    // Step 6: Update referral code
    await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [userReferralCode, user.id]);
    console.log('Referral code set:', userReferralCode);

    // Step 7: Credit waitlist
    await pool.query('UPDATE tribes SET waitlist_signups = waitlist_signups + 1 WHERE id = $1', [tribeId]);
    console.log('Waitlist credited');

    // Step 8: Check existing member
    const existingMember = await pool.query('SELECT 1 FROM tribe_members WHERE user_id = $1 AND tribe_id = $2', [user.id, tribeId]);
    console.log('Existing member check:', existingMember.rows.length);
    if (existingMember.rows.length === 0) {
      await pool.query('INSERT INTO tribe_members (user_id, tribe_id, tier, contribution_points) VALUES ($1, $2, $3, $4)', [user.id, tribeId, 'Supporter', 1]);
      console.log('Tribe member added');
    }

    // Step 9: Update member_count
    await pool.query('UPDATE tribes SET member_count = member_count + 1 WHERE id = $1', [tribeId]);
    console.log('Member count updated');

    console.log('\n✅ ALL STEPS COMPLETED');
  } catch (err) {
    console.error('ERROR at:', err.message);
  } finally {
    await pool.end();
  }
}

simulate();