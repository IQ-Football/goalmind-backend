/**
 * African Giants Scoring Service
 * 
 * Implements the "African Power Table" scoring system:
 * Tribe_Score = (Total_Waitlist_Signups * 1.0)
 *              + (Avg_Fan_IQ * 0.5)
 *              + (Daily_Engagement_Streak_Points * 0.3)
 * 
 * Features:
 * - Giant of the Day: daily featured tribe with bonus questions
 * - Rivalry Boosters: 2x points on Derby Days
 * - Waitlist signup tracking
 * - Daily engagement streak tracking
 */

import { awardBadge, awardBadgeWithTribeCap, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD } from './achievementService.js';

// Scoring weights
const WEIGHT_WAITLIST = 1.0;
const WEIGHT_AVG_IQ   = 0.5;
const WEIGHT_ENGAGEMENT = 0.3;

// Tribal Bonus: 1.5x points for fans whose tribe is today's Giant of the Day
const WEIGHT_TRIBAL_BONUS = 1.5;

// Rivalry pairs for African Giants Derby Days
// Keyed by rivalry pair (sorted alphabetically)
const AFRICAN_RIVALRIES = {
  'al-ahly:zamalek':        { name: 'Cairo Derby',          tribes: ['al-ahly', 'zamalek'] },
  'kaizer-chiefs:orlando-pirates': { name: 'Soweto Derby', tribes: ['kaizer-chiefs', 'orlando-pirates'] },
  'raja-casablanca:wydad-casablanca': { name: 'Casablanca Derby', tribes: ['raja-casablanca', 'wydad-casablanca'] },
  'simba-sc:yanga-sc':      { name: 'Kariakoo Derby',      tribes: ['simba-sc', 'yanga-sc'] },
};

// 12 Super-Tribe slugs
export const SUPER_TRIBE_SLUGS = new Set([
  'al-ahly', 'zamalek', 'raja-casablanca', 'wydad-casablanca',
  'esperance-de-tunis', 'simba-sc', 'yanga-sc', 'tp-mazembe',
  'kaizer-chiefs', 'orlando-pirates', 'mamelodi-sundowns', 'asante-kotoko',
]);

/**
 * Build rivalry key from two slugs (alphabetically sorted)
 */
function rivalryKey(slug1, slug2) {
  return [slug1, slug2].sort().join(':');
}

/**
 * Check if two tribes are African Giants rivals
 */
export function isAfricanRivalry(slug1, slug2) {
  if (!slug1 || !slug2) return false;
  return AFRICAN_RIVALRIES[rivalryKey(slug1, slug2)] !== undefined;
}

/**
 * Get rivalry info for a derby pair
 */
export function getRivalryInfo(slug1, slug2) {
  return AFRICAN_RIVALRIES[rivalryKey(slug1, slug2)] || null;
}

/**
 * Get rivalry multiplier (2x on derby day, 1x otherwise)
 * For now, derby day is always active for configured rivalries
 */
export function getRivalryMultiplier(slug1, slug2) {
  return isAfricanRivalry(slug1, slug2) ? 2 : 1;
}

/**
 * Calculate African Power Table score for a tribe
 * Returns breakdown: { totalScore, waitlistScore, iqScore, engagementScore, breakdown }
 */
export async function calculatePowerTableScore(fastify, tribeId) {
  const tribeResult = await fastify.db.query(
    `SELECT waitlist_signups, avg_fan_iq, daily_engagement_points, slug
     FROM tribes WHERE id = $1`,
    [tribeId]
  );

  if (tribeResult.rows.length === 0) {
    return null;
  }

  const tribe = tribeResult.rows[0];
  const waitlistSignups = parseInt(tribe.waitlist_signups) || 0;
  const avgFanIq        = parseFloat(tribe.avg_fan_iq) || 0;
  const engagementPts   = parseInt(tribe.daily_engagement_points) || 0;

  const waitlistScore = waitlistSignups * WEIGHT_WAITLIST;
  const iqScore       = avgFanIq * WEIGHT_AVG_IQ;
  const engagementScore = engagementPts * WEIGHT_ENGAGEMENT;
  const totalScore    = waitlistScore + iqScore + engagementScore;

  return {
    tribeId,
    slug: tribe.slug,
    totalScore: Math.floor(totalScore),
    waitlistScore: Math.floor(waitlistScore),
    iqScore: Math.floor(iqScore),
    engagementScore: Math.floor(engagementScore),
    breakdown: {
      waitlistSignups,
      avgFanIq: parseFloat(avgFanIq.toFixed(2)),
      engagementPoints: engagementPts,
      weights: { waitlist: WEIGHT_WAITLIST, iq: WEIGHT_AVG_IQ, engagement: WEIGHT_ENGAGEMENT },
    },
  };
}

/**
 * Get African Power Table leaderboard — all 12 Super-Tribes ranked by composite score
 */
export async function getAfricanPowerTable(fastify, limit = 12) {
  try {
    const result = await fastify.db.query(
      `SELECT id, name, slug, primary_color, secondary_color, logo_url,
              waitlist_signups, avg_fan_iq, daily_engagement_points, region
       FROM tribes
       WHERE slug = ANY($1)
       ORDER BY (
         (COALESCE(waitlist_signups, 0) * 1.0)
         + (COALESCE(avg_fan_iq, 0)::numeric * 0.5)
         + (COALESCE(daily_engagement_points, 0) * 0.3)
       ) DESC
       LIMIT $2`,
      [Array.from(SUPER_TRIBE_SLUGS), Math.min(limit, 12)]
    );

    const leaderboard = result.rows.map((tribe, idx) => {
      const waitlistScore = (parseInt(tribe.waitlist_signups) || 0) * WEIGHT_WAITLIST;
      const iqScore       = (parseFloat(tribe.avg_fan_iq) || 0) * WEIGHT_AVG_IQ;
      const engScore      = (parseInt(tribe.daily_engagement_points) || 0) * WEIGHT_ENGAGEMENT;
      const total        = Math.floor(waitlistScore + iqScore + engScore);

      return {
        rank: idx + 1,
        tribeId: tribe.id,
        name: tribe.name,
        slug: tribe.slug,
        region: tribe.region,
        logoUrl: tribe.logo_url,
        colors: {
          primary: tribe.primary_color,
          secondary: tribe.secondary_color,
        },
        powerTableScore: total,
        breakdown: {
          waitlistScore: Math.floor(waitlistScore),
          avgFanIq: parseFloat((parseFloat(tribe.avg_fan_iq) || 0).toFixed(2)),
          engagementScore: Math.floor(engScore),
        },
        classification: 'Continental: Africa',
        isSuperTribe: true,
      };
    });

    return leaderboard;
  } catch (err) {
    fastify.log.error('Error getting African Power Table:', err);
    return [];
  }
}

/**
 * Record a waitlist signup for a tribe
 */
export async function recordWaitlistSignup(fastify, tribeId) {
  try {
    const result = await fastify.db.query(
      'UPDATE tribes SET waitlist_signups = waitlist_signups + 1 WHERE id = $1 RETURNING waitlist_signups',
      [tribeId]
    );
    // Also track in Redis for real-time leaderboard
    await fastify.redis.hincrby('african_giants:waitlist', tribeId, 1);
    return result.rows[0]?.waitlist_signups;
  } catch (err) {
    fastify.log.error('Error recording waitlist signup:', err);
    return false;
  }
}

/**
 * Record daily engagement for a user (quiz, battle, prediction, daily_login)
 */
export async function recordDailyEngagement(fastify, userId, tribeId, engagementType = 'daily_login') {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Upsert streak record
    const result = await fastify.db.query(
      `INSERT INTO daily_engagement_streaks (user_id, tribe_id, streak_date, engagement_type, points_earned)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, tribe_id, streak_date, engagement_type)
       DO UPDATE SET points_earned = daily_engagement_streaks.points_earned + 1
       RETURNING points_earned`,
      [userId, tribeId, today, engagementType]
    );

    // Update streak count
    const streakResult = await fastify.db.query(
      `SELECT COUNT(DISTINCT streak_date) as streak_count
       FROM daily_engagement_streaks
       WHERE user_id = $1 AND tribe_id = $2
         AND streak_date >= CURRENT_DATE - INTERVAL '30 days'`,
      [userId, tribeId]
    );
    const streakCount = parseInt(streakResult.rows[0]?.streak_count) || 1;

    // Update tribe's aggregate engagement points (capped at 1000 per day to prevent abuse)
    await fastify.db.query(
      `UPDATE tribes
       SET daily_engagement_points = LEAST(COALESCE(daily_engagement_points, 0) + 1, 1000)
       WHERE id = $1`,
      [tribeId]
    );

    // Track in Redis for real-time leaderboard
    await fastify.redis.hincrby(`african_giants:engagement:${today}`, tribeId, 1);

    return { streakCount, pointsEarned: result.rows[0]?.points_earned || 1 };
  } catch (err) {
    fastify.log.error('Error recording daily engagement:', err);
    return null;
  }
}

/**
 * Update average Fan IQ for a tribe
 * Called after a user completes a "Giant IQ" quiz
 */
export async function updateAvgFanIq(fastify, tribeId) {
  try {
    await fastify.db.query(
      `UPDATE tribes t SET avg_fan_iq = sub.avg_iq
       FROM (
         SELECT tribe_id, AVG(elo) as avg_iq
         FROM users
         WHERE tribe_id = $1 AND elo IS NOT NULL
         GROUP BY tribe_id
       ) sub
       WHERE t.id = sub.tribe_id`,
      [tribeId]
    );
    return true;
  } catch (err) {
    fastify.log.error('Error updating avg fan IQ:', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// GIANT OF THE DAY
// ─────────────────────────────────────────────────────────────

/**
 * Get the Giant of the Day — rotates daily among the 12 Super-Tribes
 * Uses Redis to persist today's selection so it doesn't change mid-day
 */
export async function getGiantOfTheDay(fastify) {
  const today = new Date().toISOString().split('T')[0];
  
  // Check Redis cache first
  const cached = await fastify.redis.get(`african_giants:giant_of_day:${today}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Compute today's Giant of the Day: rotate based on day-of-year
  const slugs = Array.from(SUPER_TRIBE_SLUGS);
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const index = dayOfYear % slugs.length;
  const todaySlug = slugs[index];

  // Fetch tribe details
  const tribeResult = await fastify.db.query(
    `SELECT id, name, slug, primary_color, secondary_color, logo_url, region
     FROM tribes WHERE slug = $1`,
    [todaySlug]
  );

  if (tribeResult.rows.length === 0) {
    return null;
  }

  const tribe = tribeResult.rows[0];
  const giantData = {
    date: today,
    tribeId: tribe.id,
    name: tribe.name,
    slug: tribe.slug,
    region: tribe.region,
    logoUrl: tribe.logo_url,
    colors: { primary: tribe.primary_color, secondary: tribe.secondary_color },
    description: `Today's featured African Giant — prove your knowledge of ${tribe.name}!`,
  };

  // Cache in Redis with 24h TTL
  await fastify.redis.setex(`african_giants:giant_of_day:${today}`, 86400, JSON.stringify(giantData));

  return giantData;
}

/**
 * Get today's featured questions for the Giant of the Day
 * Returns up to 10 questions tagged with the featured tribe's slug
 */
export async function getGiantOfTheDayQuestions(fastify, tribeId, limit = 10) {
  try {
    const result = await fastify.db.query(
      `SELECT id, content, options, correct_option_index, difficulty, category, explanation
       FROM questions
       WHERE tribe_id = $1
       ORDER BY RANDOM()
       LIMIT $2`,
      [tribeId, limit]
    );
    return result.rows;
  } catch (err) {
    // Fallback without RANDOM if not supported
    fastify.log.warn('RANDOM() not supported, using id shuffle fallback:', err.message);
    try {
      const result = await fastify.db.query(
        `SELECT id, content, options, correct_option_index, difficulty, category, explanation
         FROM questions
         WHERE tribe_id = $1
         LIMIT $2`,
        [tribeId, limit]
      );
      return result.rows;
    } catch (err2) {
      fastify.log.error('Error fetching Giant of the Day questions:', err2);
      return [];
    }
  }
}

// ─────────────────────────────────────────────────────────────
// RIVALRY BOOSTERS (Derby Day 2x multiplier)
// ─────────────────────────────────────────────────────────────

/**
 * Check if today is a configured Derby Day for the given tribe pair
 * For now: always active (admin can set specific dates via Redis in production)
 */
export function isDerbyDay(slug1, slug2) {
  return isAfricanRivalry(slug1, slug2);
}

/**
 * Get all active rivalry matchups for today
 */
export function getActiveDerbies() {
  return Object.entries(AFRICAN_RIVALRIES).map(([key, value]) => ({
    key,
    ...value,
    multiplier: 2,
  }));
}

/**
 * Record points with rivalry booster applied
 * Called from battleService after a battle ends.
 * NOTE: Use calculateBattlePointsWithAllBoosters for tribal bonus support.
 */
export async function calculateBattlePointsWithBooster(fastify, basePoints, winnerSlug, loserSlug) {
  return calculateBattlePointsWithAllBoosters(fastify, basePoints, winnerSlug, loserSlug);
}

/**
 * Admin: set a specific date as derby day for a rivalry
 * (stored in Redis, checked before applying 2x multiplier)
 */
export async function setDerbyDayDate(fastify, rivalryKeyStr, dateStr) {
  await fastify.redis.setex(`african_giants:derby:${rivalryKeyStr}`, 86400 * 30, dateStr);
}

/**
 * Check if a specific date is a derby day for a rivalry
 */
export async function isDerbyDayOnDate(fastify, slug1, slug2, dateStr) {
  const key = rivalryKey(slug1, slug2);
  const storedDate = await fastify.redis.get(`african_giants:derby:${key}`);
  return storedDate === dateStr;
}

// ─────────────────────────────────────────────────────────────
// TRIBAL BONUS (1.5x for Giant of the Day fans)
// ─────────────────────────────────────────────────────────────

/**
 * Get today's Giant of the Day slug — cached in Redis for tribal bonus lookup.
 * Returns null if no Giant set for today.
 */
export async function getGiantOfTheDaySlug(fastify) {
  const today = new Date().toISOString().split('T')[0];
  
  // Try the cached giant of day data first (already has slug)
  const cached = await fastify.redis.get(`african_giants:giant_of_day:${today}`);
  if (cached) {
    const data = JSON.parse(cached);
    return data.slug;
  }
  
  // Fallback: compute from rotation
  const slugs = Array.from(SUPER_TRIBE_SLUGS);
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return slugs[dayOfYear % slugs.length];
}

/**
 * Get tribal bonus multiplier: 1.5x if user's tribe is today's Giant of the Day.
 * Returns { multiplier, isTribalBonus, tribeName }.
 */
export async function getTribalBonusMultiplier(fastify, userTribeSlug) {
  const giantSlug = await getGiantOfTheDaySlug(fastify);
  if (!giantSlug || userTribeSlug !== giantSlug) {
    return { multiplier: 1, isTribalBonus: false, giantSlug: null };
  }
  
  // Fetch tribe name for the bonus message
  const tribeResult = await fastify.db.query(
    'SELECT name FROM tribes WHERE slug = $1',
    [giantSlug]
  );
  const tribeName = tribeResult.rows[0]?.name || giantSlug;
  
  return {
    multiplier: WEIGHT_TRIBAL_BONUS,
    isTribalBonus: true,
    giantSlug,
    giantName: tribeName,
  };
}

/**
 * Calculate battle points with BOTH tribal bonus AND rivalry booster applied.
 * Tribal bonus (1.5x) is checked from winner's tribe perspective.
 * Rivalry booster (2x) applies when winner and loser are configured rivals.
 * Multipliers are multiplicative: base * tribal * rivalry.
 */
export async function calculateBattlePointsWithAllBoosters(fastify, basePoints, winnerSlug, loserSlug) {
  const tribalInfo = await getTribalBonusMultiplier(fastify, winnerSlug);
  const rivalryInfo = getRivalryMultiplier(winnerSlug, loserSlug);
  
  const tribalMultiplier = tribalInfo.multiplier;
  const rivalryMultiplier = rivalryInfo;
  const totalMultiplier = tribalMultiplier * rivalryMultiplier;
  
  return {
    basePoints,
    tribalMultiplier,
    rivalryMultiplier,
    totalMultiplier,
    boostedPoints: Math.floor(basePoints * totalMultiplier),
    isTribalBonus: tribalInfo.isTribalBonus,
    tribalGiant: tribalInfo.isTribalBonus ? tribalInfo.giantName : null,
    isDerby: rivalryMultiplier > 1,
    derbyName: rivalryMultiplier > 1 ? AFRICAN_RIVALRIES[rivalryKey(winnerSlug, loserSlug)]?.name : null,
    breakdown: {
      base: basePoints,
      tribalBonus: tribalInfo.isTribalBonus ? `×${WEIGHT_TRIBAL_BONUS}` : '×1',
      rivalryBoost: rivalryMultiplier > 1 ? '×2 (Derby)' : '×1',
      final: `×${totalMultiplier}`,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// WAITLIST SIGNUP TRACKING
// ─────────────────────────────────────────────────────────────

/**
 * Register a waitlist signup — creates user record + credits tribe score
 */
export async function registerWaitlistSignup(fastify, { email, tribeSlug, username }) {
  try {
    // Find tribe
    const tribeResult = await fastify.db.query(
      'SELECT id, name FROM tribes WHERE slug = $1 AND is_super_tribe = true',
      [tribeSlug]
    );
    if (tribeResult.rows.length === 0) {
      return { error: 'INVALID_TRIBE', message: 'Tribe not found or not a Super-Tribe' };
    }
    const tribe = tribeResult.rows[0];

    // Check if email already registered
    const existingUser = await fastify.db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existingUser.rows.length > 0) {
      return { error: 'ALREADY_REGISTERED', message: 'Email already on waitlist' };
    }

    // Create user with random temporary password (user sets real password on platform launch)
    const crypto = await import('crypto');
    const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const bcrypt = await import('bcryptjs');
    const passwordHash = bcrypt.hashSync(tempPassword, 10);
    // Determine cohort (first 500: Vanguard 500, next 500: Centurion)
    const countRes = await fastify.db.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(countRes.rows[0].count);
    let cohort = null;
    if (totalUsers < 500) {
      cohort = 'vanguard_500';
    } else if (totalUsers < 1000) {
      cohort = 'centurion';
    }

    const userResult = await fastify.db.query(
      `INSERT INTO users (username, email, password_hash, tribe_id, elo, last_active_at, cohort)
       VALUES ($1, $2, $3, $4, 1000, NOW(), $5)
       RETURNING id, username, email, cohort`,
      [username || email.split('@')[0], email, passwordHash, tribe.id, cohort]
    );
    const user = userResult.rows[0];

    // Credit tribe waitlist score
    const newCount = await recordWaitlistSignup(fastify, tribe.id);

    // Award Founding General badge if within first 10
    if (newCount && newCount <= FOUNDING_THRESHOLD) {
      await awardBadgeWithTribeCap(fastify, user.id, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD);
    }

    // Add to tribe_members if not already
    await fastify.db.query(
      `INSERT INTO tribe_members (user_id, tribe_id, tier, contribution_points)
       VALUES ($1, $2, 'Supporter', 1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id, tribe.id]
    );

    // Update tribe member_count
    await fastify.db.query(
      'UPDATE tribes SET member_count = member_count + 1 WHERE id = $1',
      [tribe.id]
    );

    return {
      success: true,
      userId: user.id,
      tribe: { id: tribe.id, name: tribe.name, slug: tribeSlug },
      message: 'Waitlist signup successful!',
    };
  } catch (err) {
    fastify.log.error('Error registering waitlist signup:', err);
    return { error: 'INTERNAL_ERROR', message: 'Failed to register waitlist signup' };
  }
}

// ─────────────────────────────────────────────────────────────
// AFRICAN GIANTS STATS
// ─────────────────────────────────────────────────────────────

/**
 * Get comprehensive stats for a tribe in the African Giants system
 */
export async function getTribeAfricanGiantsStats(fastify, tribeId) {
  try {
    const tribeResult = await fastify.db.query(
      `SELECT t.*,
              COUNT(DISTINCT tm.user_id) as super_tribe_members
       FROM tribes t
       LEFT JOIN tribe_members tm ON tm.tribe_id = t.id
       WHERE t.id = $1
       GROUP BY t.id`,
      [tribeId]
    );

    if (tribeResult.rows.length === 0) return null;
    const tribe = tribeResult.rows[0];

    // Engagement stats — last 30 days
    const engagementResult = await fastify.db.query(
      `SELECT COUNT(*) as total_engagements,
              SUM(points_earned) as total_points,
              COUNT(DISTINCT streak_date) as active_days
       FROM daily_engagement_streaks
       WHERE tribe_id = $1 AND streak_date >= CURRENT_DATE - INTERVAL '30 days'`,
      [tribeId]
    );
    const engagement = engagementResult.rows[0];

    // Rivalry stats
    const rivalIds = tribe.rival_tribe_ids || [];
    let rivalStats = [];
    if (rivalIds.length > 0) {
      const rivalResult = await fastify.db.query(
        `SELECT t.id, t.name, t.slug, t.waitlist_signups, t.avg_fan_iq, t.daily_engagement_points,
                (t.waitlist_signups * $2) + (t.avg_fan_iq::numeric * $3) + (t.daily_engagement_points * $4) as power_score
         FROM tribes t WHERE t.id = ANY($1)`,
        [rivalIds, WEIGHT_WAITLIST, WEIGHT_AVG_IQ, WEIGHT_ENGAGEMENT]
      );
      rivalStats = rivalResult.rows;
    }

    return {
      tribe: {
        id: tribe.id,
        name: tribe.name,
        slug: tribe.slug,
        region: tribe.region,
        isSuperTribe: tribe.is_super_tribe,
      },
      powerTable: {
        score: Math.floor(
          (parseInt(tribe.waitlist_signups) || 0) * WEIGHT_WAITLIST
          + (parseFloat(tribe.avg_fan_iq) || 0) * WEIGHT_AVG_IQ
          + (parseInt(tribe.daily_engagement_points) || 0) * WEIGHT_ENGAGEMENT
        ),
        waitlistSignups: parseInt(tribe.waitlist_signups) || 0,
        avgFanIq: parseFloat(tribe.avg_fan_iq) || 0,
        dailyEngagementPoints: parseInt(tribe.daily_engagement_points) || 0,
      },
      engagement: {
        totalEngagements: parseInt(engagement.total_engagements) || 0,
        totalPoints: parseInt(engagement.total_points) || 0,
        activeDays: parseInt(engagement.active_days) || 0,
      },
      memberCount: parseInt(tribe.member_count) || 0,
      superTribeMembers: parseInt(tribe.super_tribe_members) || 0,
      rivalTribes: rivalStats,
    };
  } catch (err) {
    fastify.log.error('Error getting tribe AG stats:', err);
    return null;
  }
}

export default {
  // Scoring
  calculatePowerTableScore,
  getAfricanPowerTable,
  calculateBattlePointsWithBooster,
  // Giant of the Day
  getGiantOfTheDay,
  getGiantOfTheDayQuestions,
  // Rivalry Boosters
  isAfricanRivalry,
  getRivalryInfo,
  getRivalryMultiplier,
  isDerbyDay,
  getActiveDerbies,
  setDerbyDayDate,
  isDerbyDayOnDate,
  // Waitlist
  recordWaitlistSignup,
  recordDailyEngagement,
  updateAvgFanIq,
  registerWaitlistSignup,
  // Stats
  getTribeAfricanGiantsStats,
  // Constants
  AFRICAN_RIVALRIES,
  WEIGHT_WAITLIST,
  WEIGHT_AVG_IQ,
  WEIGHT_ENGAGEMENT,
};
