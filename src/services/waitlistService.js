/**
 * Waitlist Service — The Recruitment Drive Frontline
 * Handles waitlist signups with referral attribution and tribe waitlist scoring
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { awardBadge, awardBadgeWithTribeCap, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD, checkAndAward25kSurgeBadge } from './achievementService.js';
import { recordReferralAttribution, checkAndAwardMilestoneRewards, resolveReferrerId, PARTNER_CODES, PARTNER_SYSTEM_USER_ID } from './referralService.js';

// Generate a unique referral code for a new user
function generateReferralCode(userId, tribeId) {
  const hash = crypto.createHash('sha256')
    .update(`${userId}:${tribeId}:${Date.now()}`)
    .digest('hex')
    .substring(0, 8);
  return `GM_${tribeId.substring(0, 4)}_${hash}`.toUpperCase();
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Register a waitlist signup with referral attribution.
 * 
 * Steps:
 * 1. Validate inputs (name, email, tribeId required)
 * 2. Check tribe exists and is valid
 * 3. Check email not already registered
 * 4. Check referral code validity (if provided) — attribute to referrer
 * 5. Create user with generated referral code
 * 6. Credit tribe waitlist count
 * 7. Add to tribe_members
 * 8. Attribute referral to referrer (if applicable)
 * 9. Return user's referral code so they can share
 */
export async function registerWaitlistSignup(fastify, { name, email, tribeId, referralCode }) {
  try {
    // Validate required fields
    if (!email || !isValidEmail(email)) {
      return { error: 'VALIDATION_ERROR', message: 'A valid email is required' };
    }

    // Check email not already registered
    const existingUser = await fastify.db.query(
      'SELECT id, username, tribe_id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (existingUser.rows.length > 0) {
      // If user exists but onboarding not complete, we can return the existing user
      // or error if they are already fully registered.
      // For now, let's treat ALREADY_REGISTERED as the standard response.
      return { error: 'ALREADY_REGISTERED', message: 'Email already on waitlist' };
    }

    // Check tribe exists (if provided)
    let tribe = null;
    let effectiveTribeId = tribeId;

    // Check referral code validity (if provided) and find referrer
    const { referrerId, effectiveTribeId: refTribeId } = await resolveReferrerId(fastify, referralCode);
    if (refTribeId) effectiveTribeId = refTribeId;

    if (effectiveTribeId) {
      const tribeResult = await fastify.db.query(
        'SELECT id, name, slug, is_super_tribe, waitlist_signups FROM tribes WHERE id::text = $1 OR slug = $1',
        [effectiveTribeId]
      );
      if (tribeResult.rows.length === 0) {
        return { error: 'INVALID_TRIBE', message: 'Tribe not found' };
      }
      tribe = tribeResult.rows[0];
    }

    // Generate temp password
    const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);

    // Create user (username defaults to part of email if name not provided)
    let defaultUsername = name ? name.trim() : email.split('@')[0];
    
    // Determine cohort (first 500: Vanguard 500, next 500: Centurion)
    const countRes = await fastify.db.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(countRes.rows[0].count);
    let cohort = null;
    if (totalUsers < 500) {
      cohort = 'vanguard_500';
    } else if (totalUsers < 1000) {
      cohort = 'centurion';
    }

    let userResult;
    try {
      userResult = await fastify.db.query(
        `INSERT INTO users (username, email, password_hash, tribe_id, referral_code, referred_by, elo, last_active_at, cohort)
         VALUES ($1, $2, $3, $4, $5, $6, 1000, NOW(), $7)
         RETURNING id, username, email, referral_code`,
        [defaultUsername, email.toLowerCase(), passwordHash, tribe ? tribe.id : null, null, referrerId, cohort]
      );
    } catch (dbErr) {
      // Handle duplicate username by appending a suffix
      if (dbErr.code === '23505' && dbErr.constraint === 'users_username_key') {
        defaultUsername = `${defaultUsername}_${crypto.randomInt(1000, 9999)}`;
        userResult = await fastify.db.query(
          `INSERT INTO users (username, email, password_hash, tribe_id, referral_code, referred_by, elo, last_active_at, cohort)
           VALUES ($1, $2, $3, $4, $5, $6, 1000, NOW(), $7)
           RETURNING id, username, email, referral_code`,
          [defaultUsername, email.toLowerCase(), passwordHash, tribe ? tribe.id : null, null, referrerId, cohort]
        );
      } else {
        throw dbErr;
      }
    }
    const user = userResult.rows[0];

    // Award 25k Surge badge if applicable
    await checkAndAward25kSurgeBadge(fastify, user.id);

    // Generate and update user's unique referral code
    // If no tribe, we use a generic GM_WAIT__ prefix
    const userReferralCode = tribe 
      ? generateReferralCode(user.id, tribe.id)
      : `GM_WAIT_${crypto.createHash('sha256').update(user.id).digest('hex').substring(0, 8).toUpperCase()}`;

    await fastify.db.query(
      'UPDATE users SET referral_code = $1 WHERE id = $2',
      [userReferralCode, user.id]
    );

    // If tribe provided, credit tribe and add to tribe_members
    if (tribe) {
      const tribeUpdate = await fastify.db.query(
        'UPDATE tribes SET waitlist_signups = waitlist_signups + 1, member_count = member_count + 1 WHERE id = $1 RETURNING waitlist_signups',
        [tribe.id]
      );

      const newCount = tribeUpdate.rows[0]?.waitlist_signups;
      if (newCount && newCount <= FOUNDING_THRESHOLD) {
        await awardBadgeWithTribeCap(fastify, user.id, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD);
      }

      await fastify.db.query(
        'INSERT INTO tribe_members (user_id, tribe_id, tier, contribution_points) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [user.id, tribe.id, 'Supporter', 1]
      );
    }

    // Attribute referral to referrer
    if (referrerId) {
      await recordReferralAttribution(fastify, {
        referrerId,
        recruitId: user.id,
        referralCode: referralCode.toUpperCase(),
        tribeId: tribe ? tribe.id : null,
        source: 'direct'
      });
    }

    return {
      success: true,
      user: {
        id: user.id,
        name: user.username,
        email: user.email,
        tribe: tribe ? { id: tribe.id, name: tribe.name, slug: tribe.slug } : null,
        referralCode: userReferralCode,
      },
      referralAttributed: !!referrerId,
      message: 'Waitlist signup successful!',
    };
  } catch (err) {
    fastify.log.error({ err }, 'Waitlist signup error');
    return { error: 'INTERNAL_ERROR', message: 'Failed to register waitlist signup' };
  }
}

/**
 * Complete waitlist onboarding (Step 2)
 */
export async function completeWaitlistOnboarding(fastify, { email, username, tribeId }) {
  try {
    if (!email || !username || !tribeId) {
      return { error: 'VALIDATION_ERROR', message: 'email, username, and tribeId are required' };
    }

    // Find user
    const userResult = await fastify.db.query(
      'SELECT id, tribe_id, referral_code FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (userResult.rows.length === 0) {
      return { error: 'USER_NOT_FOUND', message: 'User not found on waitlist' };
    }
    const user = userResult.rows[0];

    // Check tribe
    const tribeResult = await fastify.db.query(
      'SELECT id, name, slug FROM tribes WHERE id::text = $1 OR slug = $1',
      [tribeId]
    );
    if (tribeResult.rows.length === 0) {
      return { error: 'INVALID_TRIBE', message: 'Tribe not found' };
    }
    const tribe = tribeResult.rows[0];

    // Update user
    try {
      await fastify.db.query(
        'UPDATE users SET username = $1, tribe_id = $2 WHERE id = $3',
        [username.trim(), tribe.id, user.id]
      );
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'users_username_key') {
        return { error: 'USERNAME_TAKEN', message: 'Username is already in use' };
      }
      throw err;
    }

    // If tribe changed or was null, update tribe stats
    if (user.tribe_id !== tribe.id) {
      // Credit new tribe
      const tribeUpdate = await fastify.db.query(
        'UPDATE tribes SET waitlist_signups = waitlist_signups + 1, member_count = member_count + 1 WHERE id = $1 RETURNING waitlist_signups',
        [tribe.id]
      );
      
      const newCount = tribeUpdate.rows[0]?.waitlist_signups;
      if (newCount && newCount <= FOUNDING_THRESHOLD) {
        await awardBadgeWithTribeCap(fastify, user.id, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD);
      }

      await fastify.db.query(
        'INSERT INTO tribe_members (user_id, tribe_id, tier, contribution_points) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [user.id, tribe.id, 'Supporter', 1]
      );

      // Decrement old tribe if it existed
      if (user.tribe_id) {
        await fastify.db.query(
          'UPDATE tribes SET waitlist_signups = GREATEST(0, waitlist_signups - 1), member_count = GREATEST(0, member_count - 1) WHERE id = $1',
          [user.tribe_id]
        );
        await fastify.db.query(
          'DELETE FROM tribe_members WHERE user_id = $1 AND tribe_id = $2',
          [user.id, user.tribe_id]
        );
      }

      // Update referral code to reflect new tribe
      const newReferralCode = generateReferralCode(user.id, tribe.id);
      await fastify.db.query(
        'UPDATE users SET referral_code = $1 WHERE id = $2',
        [newReferralCode, user.id]
      );
      user.referral_code = newReferralCode;
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: username.trim(),
        email: email.toLowerCase(),
        tribe: { id: tribe.id, name: tribe.name, slug: tribe.slug },
        referralCode: user.referral_code,
      },
      message: 'Onboarding completed successfully!',
    };
  } catch (err) {
    fastify.log.error('Waitlist onboarding error:', err);
    return { error: 'INTERNAL_ERROR', message: 'Failed to complete onboarding' };
  }
}


/**
 * Get total waitlist count and optional per-tribe breakdown
 */
export async function getWaitlistCount(fastify, { byTribe = false } = {}) {
  try {
    if (!byTribe) {
      const countResult = await fastify.db.query('SELECT COUNT(*) as total FROM users');
      const cohortResult = await fastify.db.query('SELECT cohort, COUNT(*) as count FROM users GROUP BY cohort');
      
      const counts = {
        total: parseInt(countResult.rows[0].total),
        vanguard_500: 0,
        centurion: 0,
        standard: 0
      };

      cohortResult.rows.forEach(row => {
        if (row.cohort === 'vanguard_500') counts.vanguard_500 = parseInt(row.count);
        else if (row.cohort === 'centurion') counts.centurion = parseInt(row.count);
        else counts.standard += parseInt(row.count);
      });

      return {
        success: true,
        data: counts,
      };
    }

    // Per-tribe breakdown
    const breakdownResult = await fastify.db.query(
      `SELECT t.id as tribe_id, t.name, t.slug, 
              COUNT(u.id)::int as signups,
              COUNT(CASE WHEN u.cohort = 'vanguard_500' THEN 1 END)::int as vanguard_500,
              COUNT(CASE WHEN u.cohort = 'centurion' THEN 1 END)::int as centurion
       FROM tribes t
       LEFT JOIN users u ON u.tribe_id = t.id
       GROUP BY t.id, t.name, t.slug
       ORDER BY signups DESC, t.name ASC`
    );

    const totalResult = await fastify.db.query('SELECT COUNT(*) as total FROM users');

    return {
      success: true,
      data: {
        total: parseInt(totalResult.rows[0].total),
        breakdown: breakdownResult.rows.map(r => ({
          tribeId: r.tribe_id,
          name: r.name,
          slug: r.slug,
          signups: r.signups,
          vanguard_500: r.vanguard_500,
          centurion: r.centurion,
        })),
      },
    };
  } catch (err) {
    fastify.log.error('Waitlist count error:', err);
    return { error: 'INTERNAL_ERROR', message: 'Failed to fetch waitlist count' };
  }
}