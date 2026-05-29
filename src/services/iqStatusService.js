/**
 * IQ Status Service — "Football IQ Identity Card" (10-Tier Legendary Edition)
 * 
 * Manages the Football IQ Status data layer:
 * - 10-tier titles (Amateur → GOAT) based on ELO
 * - Global rank + percentile from Redis leaderboard
 * - National percentile computed on-the-fly
 * - CP-based tribal seniority
 * - Mastery badges awarded per question category
 */

import config from '../config.js';

// ─── 10-TIER DEFINITIONS ──────────────────────────────────────────────────────

export const IQ_TIERS = [
  { tier: 1,  name: 'Amateur',           minElo: 0,    maxElo: 800,   icon: '🥉', color: '#9CA3AF' },
  { tier: 2,  name: 'Supporter',         minElo: 801,  maxElo: 1000,  icon: '🥈', color: '#CD7F32' },
  { tier: 3,  name: 'Ultra',             minElo: 1001, maxElo: 1200,  icon: '🥉', color: '#C0C0C0' },
  { tier: 4,  name: 'Regional Hero',     minElo: 1201, maxElo: 1400,  icon: '🏅', color: '#FFD700' },
  { tier: 5,  name: 'National Talent',   minElo: 1401, maxElo: 1600,  icon: '🏆', color: '#E5E4E2' },
  { tier: 6,  name: 'Continental Pro',   minElo: 1601, maxElo: 1800,  icon: '💎', color: '#B9F2FF' },
  { tier: 7,  name: 'World Class',       minElo: 1801, maxElo: 2000,  icon: '🔥', color: '#FF6B35' },
  { tier: 8,  name: 'Elite Tactician',  minElo: 2001, maxElo: 2200,  icon: '🟢', color: '#50C878' },
  { tier: 9,  name: 'Legend',            minElo: 2201, maxElo: 2400,  icon: '⬛', color: '#1A1A1A' },
  { tier: 10, name: 'GOAT',              minElo: 2401, maxElo: 99999, icon: '👑', color: '#FFD700' },
];

export function getTierForElo(elo) {
  for (const tier of IQ_TIERS) {
    if (elo >= tier.minElo && elo <= tier.maxElo) return tier;
  }
  return IQ_TIERS[0]; // Amateur
}

export function getTierFloor(tierNum) {
  const tier = IQ_TIERS.find(t => t.tier === tierNum);
  return tier ? tier.minElo : 0;
}

// ─── USER IQ PROFILE TABLE ─────────────────────────────────────────────────────

export async function ensureIQProfileTable(fastify) {
  const sql = `
    CREATE TABLE IF NOT EXISTS user_iq_profiles (
      user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tier               INTEGER NOT NULL DEFAULT 1,
      tier_name          VARCHAR(20) NOT NULL DEFAULT 'Amateur',
      tier_icon          VARCHAR(10) NOT NULL DEFAULT '🥉',
      tier_color         VARCHAR(10) NOT NULL DEFAULT '#9CA3AF',
      global_rank        INTEGER,
      global_percentile  DECIMAL(5,2),
      national_rank      INTEGER,
      national_percentile DECIMAL(5,2),
      tribal_rank        INTEGER,
      quiz_count         INTEGER NOT NULL DEFAULT 0,
      correct_count      INTEGER NOT NULL DEFAULT 0,
      accuracy_rate      DECIMAL(5,2) NOT NULL DEFAULT 0,
      avg_response_time  DECIMAL(7,2) NOT NULL DEFAULT 0,
      contribution_points INTEGER NOT NULL DEFAULT 0,
      last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  try {
    await fastify.db.query(sql);
  } catch (err) {
    fastify.log.error('ensureIQProfileTable:', err.message);
  }
}

// ─── COMPUTE FULL IQ PROFILE ──────────────────────────────────────────────────

export async function computeIQProfile(fastify, userId) {
  // Get user + tribe info
  const userResult = await fastify.db.query(
    `SELECT u.id, u.username, u.email, u.elo, u.battles_played, u.battles_won,
            u.nation_points, u.title, u.streak_days, u.status,
            u.contribution_points, u.decay_immunity_days, u.cohort,
            t.name as tribe_name, t.slug as tribe_slug, t.type as tribe_type,

            (SELECT MAX(member_count) FROM tribes) as max_tribe_member_count,
            u.created_at as joined_at,
            tm.is_vanguard_100, tm.is_zero_breaker, tm.is_founding_general, tm.metadata as tm_metadata
            FROM users u
            LEFT JOIN tribes t ON u.tribe_id = t.id
            LEFT JOIN tribe_members tm ON u.id = tm.user_id
            WHERE u.id = $1`,
            [userId]
            );
            if (userResult.rows.length === 0) return null;
            const user = userResult.rows[0];
            const tmMetadata = user.tm_metadata || {};
            const fgBadge = tmMetadata.badges?.founding_general || {};

            // Determine tier from ELO (10-tier)
  const tier = getTierForElo(user.elo);

  // Global rank from Redis
  const globalRank = await fastify.redis.zrevrank('leaderboard:global', userId);
  const totalUsers = await fastify.redis.zcard('leaderboard:global');
  const globalPercentile = globalRank !== null && totalUsers > 0
    ? Number(((totalUsers - globalRank - 1) / totalUsers * 100).toFixed(2))
    : null;

  // National percentile (if national tribe)
  let nationalRank = null;
  let nationalPercentile = null;
  if (user.tribe_type === 'club' && user.tribe_slug) {
    nationalRank = await fastify.redis.zrevrank(`national:${user.tribe_slug}`, userId);
    const nationalTotal = await fastify.redis.zcard(`national:${user.tribe_slug}`);
    nationalPercentile = nationalRank !== null && nationalTotal > 0
      ? Number(((nationalTotal - nationalRank - 1) / nationalTotal * 100).toFixed(2))
      : null;
  }

  // Tribal rank
  let tribalRank = null;
  if (user.tribe_id) {
    tribalRank = await fastify.redis.zrevrank(`tribe:${user.tribe_id}`, userId);
  }

  // Quiz stats
  const quizResult = await fastify.db.query(
    `SELECT COUNT(*) as quiz_count,
            SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct_count,
            AVG(response_time_ms) as avg_response_time
     FROM battle_rounds
     WHERE user_id = $1`,
    [userId]
  );
  const { quiz_count, correct_count, avg_response_time } = quizResult.rows[0];
  const accuracyRate = quiz_count > 0 ? Number(((correct_count || 0) / quiz_count * 100).toFixed(2)) : 0;

  // CP-based Tribal Seniority (contribution_points column required)
  const contributionPoints = Number(user.contribution_points) || 0;
  const tribalSeniority = getTribalSeniority(contributionPoints);

  // Get decay immunity status
  const immunityDays = Number(user.decay_immunity_days) || 0;

  // Upsert profile
  await fastify.db.query(
    `INSERT INTO user_iq_profiles (
      user_id, tier, tier_name, tier_icon, tier_color,
      global_rank, global_percentile,
      national_rank, national_percentile,
      tribal_rank, quiz_count, correct_count,
      accuracy_rate, avg_response_time, contribution_points, last_calculated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      tier = EXCLUDED.tier,
      tier_name = EXCLUDED.tier_name,
      tier_icon = EXCLUDED.tier_icon,
      tier_color = EXCLUDED.tier_color,
      global_rank = EXCLUDED.global_rank,
      global_percentile = EXCLUDED.global_percentile,
      national_rank = EXCLUDED.national_rank,
      national_percentile = EXCLUDED.national_percentile,
      tribal_rank = EXCLUDED.tribal_rank,
      quiz_count = EXCLUDED.quiz_count,
      correct_count = EXCLUDED.correct_count,
      accuracy_rate = EXCLUDED.accuracy_rate,
      avg_response_time = EXCLUDED.avg_response_time,
      contribution_points = EXCLUDED.contribution_points,
      last_calculated_at = NOW()`,
    [
      userId, tier.tier, tier.name, tier.icon, tier.color,
      globalRank !== null ? globalRank + 1 : null,
      globalPercentile,
      nationalRank !== null ? nationalRank + 1 : null,
      nationalPercentile,
      tribalRank !== null ? tribalRank + 1 : null,
      Number(quiz_count) || 0,
      Number(correct_count) || 0,
      accuracyRate,
      Number(avg_response_time) || 0,
      contributionPoints,
    ]
  );

  // Award mastery badges
  const newBadges = await awardCategoryBadges(fastify, userId);

  // Get all user badges
  const badgesResult = await fastify.db.query(
    `SELECT a.slug, a.badge_url 
     FROM user_achievements ua 
     JOIN achievements a ON ua.achievement_id = a.id 
     WHERE ua.user_id = $1`,
    [userId]
  );
  const userBadges = {};
  badgesResult.rows.forEach(b => {
    if (b.slug) {
      const camelSlug = b.slug.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      userBadges[camelSlug] = b.badge_url;
    }
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      elo: user.elo,
      tier: tier.tier,
      tierName: tier.name,
      battlesPlayed: user.battles_played,
      battlesWon: user.battles_won,
      title: user.title,
      streakDays: user.streak_days,
      status: user.status,
      prestigeStars: user.prestige_stars || 0,
      hallOfFameCount: user.hallOfFameCount || 0,
      contributionPoints,
      decayImmunityDays: immunityDays,
      isVanguard100: user.is_vanguard_100 || false,
      isZeroBreaker: user.is_zero_breaker || false,
      isFoundingGeneral: user.is_founding_general || false,
      foundingGeneralNumber: fgBadge.signup_number || null,
      cohort: user.cohort,
      hasDavidVsGoliathPotential: (parseInt(user.tribe_member_count || 0) > 0 && parseInt(user.max_tribe_member_count || 0) > 0 && parseInt(user.tribe_member_count) <= parseInt(user.max_tribe_member_count) * 0.5),
      flair: user.is_vanguard_100 ? 'Pioneer' : (user.cohort === 'centurion' ? 'Centurion' : (user.cohort === 'vanguard_500' ? 'Vanguard' : null)),
      badgeAssets: {
        ...userBadges,
        zeroBreaker: user.is_zero_breaker ? '/assets/badges/tribal_spark.png' : null,
        foundingGeneral: user.is_founding_general ? '/assets/badges/founding_general.png' : null,
        vanguard100: user.is_vanguard_100 ? '/assets/badges/founding_pro.png' : null,
        tribalWarlord: tribalSeniority.level === 'Warlord General' || tribalSeniority.level === 'High Archon' ? '/assets/badges/tribal_warlord.png' : (userBadges.tribalWarlord || null),
        davidVsGoliath: (parseInt(user.tribe_member_count || 0) > 0 && parseInt(user.max_tribe_member_count || 0) > 0 && parseInt(user.tribe_member_count) <= parseInt(user.max_tribe_member_count) * 0.5) ? '/assets/badges/giant_killer_icon.png' : null
      }
    },
    tier: { number: tier.tier, name: tier.name, icon: tier.icon, color: tier.color },
    global: {
      rank: globalRank !== null ? globalRank + 1 : null,
      totalUsers,
      percentile: globalPercentile,
    },
    national: {
      rank: nationalRank !== null ? nationalRank + 1 : null,
      percentile: nationalPercentile,
      tribe: user.tribe_type === 'club' ? user.tribe_slug : null,
    },
    tribal: {
      rank: tribalRank !== null ? tribalRank + 1 : null,
      name: user.tribe_name,
      slug: user.tribe_slug,
      seniority: tribalSeniority,
      contributionPoints,
    },
    performance: {
      quizCount: Number(quiz_count) || 0,
      correctCount: Number(correct_count) || 0,
      accuracyRate,
      avgResponseTimeMs: Number(avg_response_time) || 0,
    },
    newBadges,
  };
}

// ─── CP-BASED TRIBAL SENIORITY ────────────────────────────────────────────────

export function getTribalSeniority(cp) {
  // Based on Contribution Points (CP) earned via battles + donations
  // Titles aligned with IQ_STATUS_COPY.md epic narrative
  if (cp >= 50000) return { level: 'High Archon',      label: 'Top 1% of Tribe CP', cpRequired: 50000, cpNext: null,    perk: 'Governance & Moderation' };
  if (cp >= 15000) return { level: 'Warlord General',  label: '15,000+ CP',         cpRequired: 15000, cpNext: 50000,   perk: '1.2x CP multiplier' };
  if (cp >= 10000) return { level: 'Venerated Elder',  label: '10,000+ CP',         cpRequired: 10000, cpNext: 15000,   perk: 'Priority Event Entry' };
  if (cp >= 5000)  return { level: 'The Praetorian',   label: '5,000+ CP',          cpRequired: 5000,  cpNext: 10000,   perk: 'Exclusive avatar items' };
  if (cp >= 1500)  return { level: 'The Sentinel',     label: '1,500+ CP',          cpRequired: 1500,  cpNext: 5000,    perk: 'Vote in tribe polls' };
  if (cp >= 500)   return { level: 'The Devotee',      label: '500+ CP',            cpRequired: 500,   cpNext: 1500,    perk: 'Verified Fan badge' };
  return { level: 'The Acolyte', label: 'Initial Recruit', cpRequired: 0, cpNext: 500, perk: 'Wear tribe colors' };
}

// ─── MASTER Y BADGES ──────────────────────────────────────────────────────────

const MASTERY_CATEGORIES = [
  { category: 'History',      badge: 'historian',        threshold: 0.75, minQuizzes: 20 },
  { category: 'Tactics',     badge: 'tactician',        threshold: 0.75, minQuizzes: 20 },
  { category: 'Players',     badge: 'scout',            threshold: 0.75, minQuizzes: 20 },
  { category: 'Leagues',     badge: 'encyclopedia',     threshold: 0.75, minQuizzes: 20 },
  { category: 'Transfers',   badge: 'transfer-guru',    threshold: 0.75, minQuizzes: 20 },
];

export async function awardCategoryBadges(fastify, userId) {
  const awarded = [];
  
  for (const { category, badge, threshold, minQuizzes } of MASTERY_CATEGORIES) {
    const existing = await fastify.db.query(
      `SELECT 1 FROM user_achievements ua
       JOIN achievements a ON ua.achievement_id = a.id
       WHERE ua.user_id = $1 AND a.slug = $2`,
      [userId, badge]
    );
    if (existing.rows.length > 0) continue;

    const catResult = await fastify.db.query(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN br.is_correct THEN 1 ELSE 0 END) as correct
       FROM battle_rounds br
       JOIN questions q ON br.question_id = q.id
       WHERE br.user_id = $1 AND q.category = $2`,
      [userId, category]
    );
    const { total, correct } = catResult.rows[0];
    if (Number(total) < minQuizzes) continue;

    const accuracy = Number(correct) / Number(total);
    if (accuracy >= threshold) {
      const achResult = await fastify.db.query(
        'SELECT id FROM achievements WHERE slug = $1',
        [badge]
      );
      if (achResult.rows.length > 0) {
        await fastify.db.query(
          'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [userId, achResult.rows[0].id]
        );
        awarded.push({ badge, category, accuracy: Math.round(accuracy * 100) });
      }
    }
  }
  return awarded;
}

// ─── GET PROFILE (cached) ─────────────────────────────────────────────────────

export async function getIQProfile(fastify, userId) {
  const cached = await fastify.redis.get(`iq:${userId}`);
  if (cached) return JSON.parse(cached);

  const profile = await computeIQProfile(fastify, userId);
  if (profile) {
    await fastify.redis.setex(`iq:${userId}`, 300, JSON.stringify(profile));
  }
  return profile;
}

// ─── DAILY PERCENTILE JOB ─────────────────────────────────────────────────────

export async function runDailyPercentileJob(fastify) {
  const result = { processed: 0, errors: 0 };
  try {
    const usersResult = await fastify.db.query('SELECT id FROM users');
    for (const row of usersResult.rows) {
      try {
        await computeIQProfile(fastify, row.id);
        result.processed++;
      } catch (err) {
        result.errors++;
      }
    }
    fastify.log.info(`Percentile job: ${result.processed} processed, ${result.errors} errors`);
    return result;
  } catch (err) {
    fastify.log.error('Daily percentile job failed:', err);
    return result;
  }
}

// ─── STREAK REWARDS ───────────────────────────────────────────────────────────

export const STREAK_REWARDS = [
  { day: 1,  multiplier: 1.0,   bonusGT: 0,    bonusBattleToken: false, flair: null },
  { day: 2,  multiplier: 1.05, bonusGT: 10,  bonusBattleToken: false, flair: null },
  { day: 3,  multiplier: 1.10, bonusGT: 20,  bonusBattleToken: false, flair: null },
  { day: 4,  multiplier: 1.15, bonusGT: 30,  bonusBattleToken: false, flair: null },
  { day: 5,  multiplier: 1.20, bonusGT: 0,   bonusBattleToken: true,  flair: null },
  { day: 6,  multiplier: 1.225,bonusGT: 50,  bonusBattleToken: false, flair: null },
  { day: 7,  multiplier: 1.25, bonusGT: 0,   bonusBattleToken: false, flair: 'Daily Focus' },
];

export function getStreakReward(streakDays) {
  const day = Math.min(Math.max(1, streakDays), 7);
  return STREAK_REWARDS[day - 1];
}

export function getStreakMultiplier(streakDays) {
  return getStreakReward(streakDays).multiplier;
}

// ─── CONTRIBUTION POINTS ─────────────────────────────────────────────────────

export async function addContributionPoints(fastify, userId, points, reason) {
  // Update user CP
  await fastify.db.query(
    `UPDATE users SET contribution_points = COALESCE(contribution_points, 0) + $1 WHERE id = $2`,
    [points, userId]
  );
  // Log to Redis for leaderboard
  const current = await fastify.redis.zscore('leaderboard:tribal_cp', userId);
  await fastify.redis.zadd('leaderboard:tribal_cp', Number(current || 0) + points, userId);
}