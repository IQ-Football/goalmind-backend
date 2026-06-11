import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import referralService from './referralService.js';
import { processTribalCatchup } from './tribeIdentityService.js';

/**
 * Create a temporary guest user.
 */
export async function createGuest(fastify, { tribeId, trialTokens = 0 }) {
  const guestId = uuidv4();
  const username = `Guest_${guestId.substring(0, 8)}`;
  
  // Determine cohort (first 500: Vanguard 500, next 500: Centurion, post-25k: Centurion Legion)
  const usersTotalCount = await fastify.redis.incr('users:total_count');

  let cohort = null;
  if (usersTotalCount <= 500) {
    cohort = 'vanguard_500';
  } else if (usersTotalCount <= 1000) {
    cohort = 'centurion';
  } else if (usersTotalCount > 25000) {
    cohort = 'centurion_legion';
  }

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // Create user record
    const userResult = await client.query(
      `INSERT INTO users (id, username, tribe_id, role, status, cohort, goal_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, tribe_id, role, cohort, goal_tokens`,
      [guestId, username, tribeId, 'guest', 'active', cohort, trialTokens]
    );

    // Add to tribe_members
    await client.query(
      `INSERT INTO tribe_members (user_id, tribe_id) VALUES ($1, $2)`,
      [guestId, tribeId]
    );

    // Update tribe member count
    await client.query(
      `UPDATE tribes SET member_count = member_count + 1 WHERE id = $1`,
      [tribeId]
    );

    await client.query('COMMIT');
    
    // Initialize guest in Redis leaderboard
    await fastify.redis.zadd('leaderboard:global', 1000, guestId);

    return userResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Convert a guest user to a registered member.
 */
export async function convertGuestToUser(fastify, guestId, { username, email, password, tribeId, referralCode }) {
  // 1. Verify guest exists and is actually a guest
  const guestResult = await fastify.db.query(
    'SELECT id, role, tribe_id FROM users WHERE id = $1',
    [guestId]
  );

  if (guestResult.rows.length === 0) {
    throw new Error('GUEST_NOT_FOUND');
  }

  if (guestResult.rows[0].role !== 'guest') {
    throw new Error('ALREADY_REGISTERED');
  }

  // 2. Check if new username or email is taken
  const existingCheck = await fastify.db.query(
    'SELECT id FROM users WHERE (username = $1 OR email = $2) AND id != $3',
    [username, email, guestId]
  );

  if (existingCheck.rows.length > 0) {
    throw new Error('USER_EXISTS');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const referralCodeNew = referralService.generateReferralCode(guestId, tribeId || guestResult.rows[0].tribe_id);

  // Handle referral attribution
  const { referrerId: referredBy } = await referralService.resolveReferrerId(fastify, referralCode);

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // Update user record
    const updateResult = await client.query(
      `UPDATE users 
       SET username = $1, 
           email = $2, 
           password_hash = $3, 
           role = $4, 
           tribe_id = COALESCE($5, tribe_id),
           referred_by = $6,
           referral_code = $7
       WHERE id = $8
       RETURNING id, username, email, tribe_id, role, cohort`,
      [username, email.toLowerCase(), passwordHash, 'user', tribeId, referredBy, referralCodeNew, guestId]
    );

    const user = updateResult.rows[0];

    // If tribe changed, update tribe_members and counts
    if (tribeId && tribeId !== guestResult.rows[0].tribe_id) {
        const oldTribeId = guestResult.rows[0].tribe_id;
        
        // Remove from old tribe
        await client.query('DELETE FROM tribe_members WHERE user_id = $1 AND tribe_id = $2', [guestId, oldTribeId]);
        await client.query('UPDATE tribes SET member_count = member_count - 1 WHERE id = $1', [oldTribeId]);

        // Add to new tribe
        await client.query('INSERT INTO tribe_members (user_id, tribe_id) VALUES ($1, $2)', [guestId, tribeId]);
        await client.query('UPDATE tribes SET member_count = member_count + 1 WHERE id = $1', [tribeId]);
    }

    await client.query('COMMIT');

    // Record referral attribution if applicable
    if (referredBy) {
      await referralService.recordReferralAttribution(fastify, {
        referrerId: referredBy,
        recruitId: guestId,
        referralCode: referralCode.toUpperCase(),
        tribeId: user.tribe_id,
        source: 'ghost_conversion',
      });
    }

    // Trigger tribal catchup for the newly registered user
    await processTribalCatchup(fastify, { userId: guestId, tribeId: user.tribe_id });

    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default {
    createGuest,
    convertGuestToUser
};
