/**
 * Referral Service — The Recruitment Drive
 * Generates unique referral links, tracks attribution, processes milestone rewards
 */

import crypto from 'crypto';
import { 
  awardBadge, 
  awardBadgeWithTribeCap, 
  awardBadgeWithGlobalCap, 
  FOUNDING_GENERAL_ID, 
  FOUNDING_PRO_ID, 
  FOUNDING_RECRUITER_ID, 
  FOUNDING_CAPTAIN_ID, 
  FOUNDING_THRESHOLD,
  SILVER_ORACLE_THRESHOLD,
  GOLD_ORACLE_THRESHOLD,
  OBSIDIAN_ORACLE_THRESHOLD,
  SEERS_EYE_BADGE_ID
} from './achievementService.js';
import { getDerbyMultipliers } from './derbyService.js';
import { creditTokens, TRANSACTION_TYPES } from './goalTokenService.js';

// Referral link prefix (used as deep link base)
const REFERRAL_PREFIX = 'goalmind://referral';
const WEB_REFERRAL_BASE = process.env.APP_URL || 'http://34.105.80.179';

// Big 7 Partner Codes Mapping
export const PARTNER_CODES = {
  'GM_ORP': '3aa4cf2e-bb8c-4396-9144-154e76bc3173', // Orlando Pirates
  'GM_AHL': '1c38b5a9-cc0d-4ac0-99c9-14e919b9b8a3', // Al Ahly
  'GM_ZAM': 'e42a5669-a208-484b-bfb4-8b50c340f2d9', // Zamalek
  'GM_SIM': '883698d2-ca17-41f0-a33a-7ae93e60be7c', // Simba SC
  'GM_TPM': '0e85f999-f02d-4599-a23b-83d94037f710', // TP Mazembe
  'GM_KZC': '4a69eb01-4d24-48b3-8a0a-6fc1ed1cdddf', // Kaizer Chiefs
  'GM_YAN': '53e4939e-3431-4ce1-bca0-c873e607650f', // Young Africans SC
  'GM_RCA': '954440b4-b7a2-4327-a5e5-8c21c61e3e82', // Raja Casablanca
  'GM_MSD': 'b8c0ec83-ae43-4bd7-afa4-5f6833445136', // Mamelodi Sundowns
  'GM_EST': 'cec10239-5993-4a9a-8bb7-fb739f8669c8', // Espérance de Tunis
};

export const PARTNER_SYSTEM_USER_ID = '00000000-0000-4000-a000-000000000000';

// Generate unique referral code for a user
export function generateReferralCode(userId, tribeId) {
  // Create a short, URL-safe code: GM_{tribe}_{random}
  const hash = crypto.createHash('sha256')
    .update(`${userId}:${tribeId}:${Date.now()}`)
    .digest('hex')
    .substring(0, 8);
  return `GM_${tribeId.substring(0, 4)}_${hash}`.toUpperCase();
}

// Build referral link (mobile deep link + web fallback)
export function buildReferralLink(referralCode, tribeId) {
  const utmSource = 'referral';
  const utmCampaign = 'recruitment_drive';
  
  return {
    deepLink: `${REFERRAL_PREFIX}?code=${referralCode}&tribe=${tribeId}`,
    webLink: `${WEB_REFERRAL_BASE}/?ref=${referralCode}&tribe=${tribeId}&utm_source=${utmSource}&utm_campaign=${utmCampaign}`,
    referralCode,
    tribeId,
  };
}

// Parse referral code from incoming link/cookie
export function parseReferralCode(referralData) {
  if (!referralData) return null;
  
  // Can be: { code, tribe } object OR just a code string
  if (typeof referralData === 'object') {
    return {
      code: referralData.code || referralData.ref || null,
      tribeId: referralData.tribe || null,
      source: referralData.source || 'direct',
    };
  }
  
  // Plain code string
  if (typeof referralData === 'string' && referralData.startsWith('GM_')) {
    return { code: referralData, tribeId: null, source: 'direct' };
  }
  
  return null;
}

// Resolve referrer ID from code, supporting partner codes
export async function resolveReferrerId(fastify, referralCode) {
  if (!referralCode) return { referrerId: null, effectiveTribeId: null };
  
  const upperCode = referralCode.toUpperCase();
  
  // 1. Check partner codes
  const basePartnerCode = Object.keys(PARTNER_CODES).find(code => upperCode.startsWith(code));
  if (basePartnerCode) {
    return { 
      referrerId: PARTNER_SYSTEM_USER_ID, 
      effectiveTribeId: PARTNER_CODES[basePartnerCode] 
    };
  }
  
  // 2. Check user codes
  const refResult = await fastify.db.query(
    'SELECT id, tribe_id FROM users WHERE referral_code = $1',
    [upperCode]
  );
  
  if (refResult.rows.length > 0) {
    return { 
      referrerId: refResult.rows[0].id, 
      effectiveTribeId: refResult.rows[0].tribe_id 
    };
  }
  
  return { referrerId: null, effectiveTribeId: null };
}

// Referral attribution record (stored when user joins via referral)
export async function recordReferralAttribution(fastify, { referrerId, recruitId, referralCode, tribeId, source }) {
  try {
    const id = crypto.randomUUID();
    
    await fastify.db.query(
      `INSERT INTO referrals (id, referrer_id, recruit_id, referral_code, tribe_id, source, status, created_at, converted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'joined', NOW(), NOW())`,
      [id, referrerId, recruitId, referralCode, tribeId, source || 'direct']
    );

    // Ensure recruit's referred_by is set in the users table
    await fastify.db.query(
      `UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL`,
      [referrerId, recruitId]
    );
    
    // Update referrer's referral count
    await fastify.db.query(
      `UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = $1`,
      [referrerId]
    );

    // --- National Captain Referral logic ---
    const referrerRes = await fastify.db.query(
      'SELECT is_national_captain FROM users WHERE id = $1',
      [referrerId]
    );
    if (referrerRes.rows[0]?.is_national_captain) {
      await fastify.db.query(
        'UPDATE users SET has_national_patriot_frame = true WHERE id = $1',
        [recruitId]
      );
      await creditTokens(fastify, {
        userId: recruitId,
        amount: 200,
        type: TRANSACTION_TYPES.INITIAL_GRANT,
        referenceId: referrerId,
        metadata: { reason: 'national_captain_referral' }
      });
      fastify.log.info({ recruitId, referrerId }, 'National Patriot reward granted via National Captain referral');
    }
    
    // Check milestone and trigger rewards
    await checkAndAwardMilestoneRewards(fastify, referrerId, 'joined', recruitId);
    
    return { success: true, referralId: id };
  } catch (err) {
    fastify.log.error({ err }, 'Failed to record referral attribution');
    return { success: false, error: err.message };
  }
}

// Check and award milestone rewards
export async function checkAndAwardMilestoneRewards(fastify, referrerId, milestone, recruitId = null) {
  const { referral_count = 0 } = await fastify.db.query(
    `SELECT referral_count FROM users WHERE id = $1`,
    [referrerId]
  ).then(r => r.rows[0] || {}).catch(() => ({ referral_count: 0 }));
  
  const rewards = [];
  
  // Milestone 1: Recruit joined same tribe
  if (milestone === 'joined' && recruitId) {
    const derbyMultipliers = await getDerbyMultipliers(fastify);
    const gtBonus = Math.round(100 * derbyMultipliers.founding_recruiter_bounty);

    rewards.push({ type: 'nation_points', amount: 500, label: 'Referral join bonus' });
    rewards.push({ type: 'goal_tokens', amount: gtBonus, label: 'Founding Recruiter GT Bonus' });
    
    // Credit 500 Nation Points to referrer
    await fastify.db.query(
      `UPDATE users SET nation_points = COALESCE(nation_points, 0) + 500 WHERE id = $1`,
      [referrerId]
    );

    // Credit GT Bonus to referrer
    await creditTokens(fastify, {
      userId: referrerId,
      amount: gtBonus,
      type: TRANSACTION_TYPES.REFERRAL_BONUS,
      referenceId: recruitId
    });
    
    // Credit 3-day Pro trial to recruit
    await fastify.db.query(
      `UPDATE users SET pro_expires_at = GREATEST(COALESCE(pro_expires_at, NOW()), NOW() + INTERVAL '3 days'), is_pro = true WHERE id = $1`,
      [recruitId]
    );
  }
  
  // Milestone 2: Recruit plays first 5 battles
  if (milestone === '5_battles') {
    rewards.push({ type: 'nation_points', amount: 1000, label: '5 battles milestone' });
    
    await fastify.db.query(
      `UPDATE users SET nation_points = COALESCE(nation_points, 0) + 1000 WHERE id = $1`,
      [referrerId]
    );
    
    // Credit GoalTokens to recruit
    let amount = 200;
    const hasAresSurgeRes = await fastify.db.query(
      "SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = '4b6c8914-87be-47ea-8942-d64e9a8f2765'",
      [recruitId]
    );
    if (hasAresSurgeRes.rows.length > 0) {
      amount = Math.round(amount * 1.2);
    }

    await creditTokens(fastify, {
      userId: recruitId,
      amount,
      type: TRANSACTION_TYPES.INITIAL_GRANT,
      metadata: { reason: '5_battles_milestone_recruit', multiplied: amount > 200 }
    });
  }
  
  // Milestone 2.5: Founding Recruiter Sprint (5 recruits)
  // Check if they just hit 5 or more and haven't received the reward yet
  if (referral_count >= 5) {
    const { has_bounty } = await fastify.db.query(
      `SELECT 1 as has_bounty FROM user_achievements WHERE user_id = $1 AND achievement_id = $2`,
      [referrerId, FOUNDING_RECRUITER_ID]
    ).then(r => r.rows[0] || {}).catch(() => ({}));

    if (!has_bounty) {
      rewards.push({ type: 'pro_extension', duration: '7 days', label: 'Founding Recruiter Pro bonus' });
      
      // Credit 7-day Pro extension to referrer
      await fastify.db.query(
        `UPDATE users SET pro_expires_at = GREATEST(COALESCE(pro_expires_at, NOW()), NOW() + INTERVAL '7 days'), is_pro = true WHERE id = $1`,
        [referrerId]
      );
      
      // Award Founding Recruiter achievement
      const awarded = await awardBadgeWithGlobalCap(fastify, referrerId, FOUNDING_RECRUITER_ID, 100);
      if (awarded) {
        rewards.push({ type: 'achievement', id: FOUNDING_RECRUITER_ID, label: 'Founding Recruiter Achievement' });
        fastify.log.info({ referrerId }, 'Founding Recruiter bounty awarded');
      }
    }
  }

  // Milestone: Founding General or Founding Captain (50 recruits)
  // Award with strict tribe cap (max 10 per tribe) for regular fans
  // Community leaders (admin/partner) or overflow recruits get Founding Captain
  if (referral_count >= 50) {
    const { role } = await fastify.db.query(
      `SELECT role FROM users WHERE id = $1`,
      [referrerId]
    ).then(r => r.rows[0] || { role: 'user' }).catch(() => ({ role: 'user' }));

    const isLeader = role === 'admin' || role === 'partner';
    
    if (isLeader) {
      // Leaders get Captain directly (no cap)
      const awarded = await awardBadge(fastify, referrerId, FOUNDING_CAPTAIN_ID);
      if (awarded) {
        rewards.push({ type: 'achievement', id: FOUNDING_CAPTAIN_ID, label: 'Founding Captain Achievement' });
        fastify.log.info({ referrerId }, 'Founding Captain awarded to leader');
      }
    } else {
      // Regular fans try for General first
      const awardedGeneral = await awardBadgeWithTribeCap(fastify, referrerId, FOUNDING_GENERAL_ID, FOUNDING_THRESHOLD);
      if (awardedGeneral) {
        rewards.push({ type: 'achievement', id: FOUNDING_GENERAL_ID, label: 'Founding General Achievement' });
        fastify.log.info({ referrerId }, 'Founding General awarded to regular fan');
      } else {
        // Fallback to Captain if General is full
        const awardedCaptain = await awardBadge(fastify, referrerId, FOUNDING_CAPTAIN_ID);
        if (awardedCaptain) {
          rewards.push({ type: 'achievement', id: FOUNDING_CAPTAIN_ID, label: 'Founding Captain Achievement (Overflow)' });
          fastify.log.info({ referrerId }, 'Founding Captain awarded (overflow)');
        }
      }
    }
  }
  
  // Milestone 3: Recruit reaches Regional league tier
  if (milestone === 'regional') {
    rewards.push({ type: 'nation_points', amount: 2500, label: 'Regional tier milestone' });
    rewards.push({ type: 'badge', badge: 'Recruiter', label: 'Recruiter badge earned' });
    
    await fastify.db.query(
      `UPDATE users SET nation_points = COALESCE(nation_points, 0) + 2500 WHERE id = $1`,
      [referrerId]
    );
    
    // Award Recruiter badge
    await fastify.db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at) 
       SELECT $1, id, NOW() FROM badges WHERE slug = 'recruiter' AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = (SELECT id FROM badges WHERE slug = 'recruiter'))`,
      [referrerId]
    );
    
    // Credit 500 GoalTokens to recruit
    if (recruitId) {
      await creditTokens(fastify, {
        userId: recruitId,
        amount: 500,
        type: TRANSACTION_TYPES.INITIAL_GRANT,
        metadata: { reason: 'regional_tier_milestone_recruit' }
      });
    }
  }
  
  // Milestone 4: Referrer recruits 10+ people
  if (referral_count >= 10 && referral_count < 25) {
    rewards.push({ type: 'title', title: 'Tribe General', label: 'Tribe General title' });
    rewards.push({ type: 'collectible', collectible: 'Nation Banner', label: 'Exclusive Nation Banner' });
    
    await fastify.db.query(
      `UPDATE users SET title = 'Tribe General' WHERE id = $1 AND title IS NULL`,
      [referrerId]
    );
  }
  
  // Milestone 5: Referrer recruits 25+ people
  if (referral_count >= 25) {
    rewards.push({ type: 'badge', badge: 'National Hero', label: 'National Hero badge' });
    rewards.push({ type: 'badge', badge: 'Top Recruiter', label: 'Top Recruiter leaderboard' });

    await fastify.db.query(
      `UPDATE users SET title = 'National Hero' WHERE id = $1 AND title IS NULL`,
      [referrerId]
    );

    // Award National Hero badge
    await fastify.db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at)
       SELECT $1, id, NOW() FROM badges WHERE slug = 'national_hero' AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = (SELECT id FROM badges WHERE slug = 'national_hero'))`,
      [referrerId]
    );
  }

  // --- 🌊 Whale Hunter Influencer Tiers (Centurion Surge) ---

  // 1. Silver Oracle (5,000 recruits)
  if (referral_count >= SILVER_ORACLE_THRESHOLD) {
    const { oracle_status } = await fastify.db.query(
      `SELECT oracle_status FROM users WHERE id = $1`,
      [referrerId]
    ).then(r => r.rows[0] || {});

    if (oracle_status === null) {
      rewards.push({ type: 'oracle_status', tier: 'silver', label: 'Silver Oracle Status' });
      rewards.push({ type: 'goal_tokens', amount: 5000, label: 'Silver Oracle GT Bonus' });

      await fastify.db.query(
        `UPDATE users SET oracle_status = 'silver' WHERE id = $1`,
        [referrerId]
      );

      await creditTokens(fastify, {
        userId: referrerId,
        amount: 5000,
        type: TRANSACTION_TYPES.REFERRAL_BONUS,
        metadata: { tier: 'silver_oracle' }
      });

      // Custom "Tribe Voice" Emote Pack (represented as collectible)
      await fastify.db.query(
        `INSERT INTO user_collectibles (id, user_id, collectible_id, acquired_at)
         VALUES (gen_random_uuid(), $1, 'emote_pack_tribe_voice', NOW())
         ON CONFLICT (user_id, collectible_id) DO NOTHING`,
        [referrerId]
      );
    }
  }

  // 2. Gold Oracle (10,000 recruits)
  if (referral_count >= GOLD_ORACLE_THRESHOLD) {
    const { oracle_status } = await fastify.db.query(
      `SELECT oracle_status FROM users WHERE id = $1`,
      [referrerId]
    ).then(r => r.rows[0] || {});

    if (oracle_status === 'silver') {
      rewards.push({ type: 'oracle_status', tier: 'gold', label: 'Gold Oracle Status' });
      rewards.push({ type: 'goal_tokens', amount: 15000, label: 'Gold Oracle GT Bonus' });

      await fastify.db.query(
        `UPDATE users SET oracle_status = 'gold', title = 'Oracle' WHERE id = $1`,
        [referrerId]
      );

      await creditTokens(fastify, {
        userId: referrerId,
        amount: 15000,
        type: TRANSACTION_TYPES.REFERRAL_BONUS,
        metadata: { tier: 'gold_oracle' }
      });

      // Award "The Seer's Eye" Badge
      await awardBadge(fastify, referrerId, SEERS_EYE_BADGE_ID);
    }
  }

  // 3. Obsidian Oracle (20,000 recruits)
  if (referral_count >= OBSIDIAN_ORACLE_THRESHOLD) {
    const { oracle_status } = await fastify.db.query(
      `SELECT oracle_status FROM users WHERE id = $1`,
      [referrerId]
    ).then(r => r.rows[0] || {});

    if (oracle_status === 'gold') {
      rewards.push({ type: 'oracle_status', tier: 'obsidian', label: 'Obsidian Oracle Status' });
      rewards.push({ type: 'goal_tokens', amount: 50000, label: 'Obsidian Oracle GT Bonus' });

      await fastify.db.query(
        `UPDATE users SET oracle_status = 'obsidian' WHERE id = $1`,
        [referrerId]
      );

      await creditTokens(fastify, {
        userId: referrerId,
        amount: 50000,
        type: TRANSACTION_TYPES.REFERRAL_BONUS,
        metadata: { tier: 'obsidian_oracle' }
      });

      // Animated Obsidian Frame
      await fastify.db.query(
        `INSERT INTO user_collectibles (id, user_id, collectible_id, acquired_at)
         VALUES (gen_random_uuid(), $1, 'frame_obsidian_oracle', NOW())
         ON CONFLICT (user_id, collectible_id) DO NOTHING`,
        [referrerId]
      );
    }
  }

  if (rewards.length > 0) {

  }
  
  return rewards;
}

// Get top recruiters leaderboard (per nation or global)
export async function getTopRecruiters(fastify, { limit = 10, tribeId = null } = {}) {
  let query = `
    SELECT u.id, u.username, u.tribe_id, title, u.referral_count, t.name as tribe_name, t.slug as tribe_slug
    FROM users u
    JOIN tribes t ON t.id = u.tribe_id
    WHERE u.referral_count > 0
  `;
  const params = [];
  
  if (tribeId) {
    query += ` AND u.tribe_id = $1`;
    params.push(tribeId);
  }
  
  query += ` ORDER BY u.referral_count DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  
  const result = await fastify.db.query(query, params);
  
  return result.rows.map((row, idx) => ({
    rank: idx + 1,
    userId: row.id,
    username: row.username,
    tribeName: row.tribe_name,
    tribeSlug: row.tribe_slug,
    referralCount: row.referral_count,
    title: row.title,
  }));
}

// Get user's referral stats
export async function getUserReferralStats(fastify, userId) {
  const user = await fastify.db.query(
    `SELECT referral_count, nation_points, title, oracle_status, last_herald_horn_at FROM users WHERE id = $1`,
    [userId]
  ).then(r => r.rows[0]);
  
  const referrals = await fastify.db.query(
    `SELECT r.*, u.username as recruit_username, u.created_at as recruit_joined_at
     FROM referrals r
     LEFT JOIN users u ON u.id = r.recruit_id
     WHERE r.referrer_id = $1
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [userId]
  );
  
  // Calculate milestone progress
  const count = user?.referral_count || 0;
  const milestones = {
    nextReward: count < 5 ? 'Reach 5 recruits for Founding Recruiter' : 
                count < 10 ? 'Reach 10 recruits for Tribe General' : 
                count < 25 ? 'Reach 25 recruits for National Hero' : 
                count < SILVER_ORACLE_THRESHOLD ? `Reach ${SILVER_ORACLE_THRESHOLD} for Silver Oracle` :
                count < GOLD_ORACLE_THRESHOLD ? `Reach ${GOLD_ORACLE_THRESHOLD} for Gold Oracle` :
                count < OBSIDIAN_ORACLE_THRESHOLD ? `Reach ${OBSIDIAN_ORACLE_THRESHOLD} for Obsidian Oracle` : 'Max level reached',
    foundingRecruiterProgress: Math.min(100, (count / 5) * 100),
    tribeGeneralProgress: Math.min(100, (count / 10) * 100),
    nationalHeroProgress: Math.min(100, (count / 25) * 100),
    foundingGeneralProgress: Math.min(100, (count / 50) * 100),
    foundingCaptainProgress: Math.min(100, (count / 50) * 100),
    silverOracleProgress: Math.min(100, (count / SILVER_ORACLE_THRESHOLD) * 100),
    goldOracleProgress: Math.min(100, (count / GOLD_ORACLE_THRESHOLD) * 100),
    obsidianOracleProgress: Math.min(100, (count / OBSIDIAN_ORACLE_THRESHOLD) * 100),
    currentTitle: user?.title || null,
    nationPoints: user?.nation_points || 0,
    oracleStatus: user?.oracle_status || null,
  };
  
  return {
    referralCount: count,
    milestones,
    recentReferrals: referrals.rows.map(r => ({
      recruitId: r.recruit_id,
      recruitUsername: r.recruit_username,
      status: r.status,
      joinedAt: r.converted_at,
    })),
  };
}

// Prepare the infrastructure for 'The Herald's Horn' global notification trigger (Obsidian Tier)
export async function triggerHeraldsHorn(fastify, userId, message) {
  const user = await fastify.db.query(
    `SELECT oracle_status, last_herald_horn_at FROM users WHERE id = $1`,
    [userId]
  ).then(r => r.rows[0]);

  if (!user || user.oracle_status !== 'obsidian') {
    throw new Error('Unauthorized: Only Obsidian Oracles can use The Herald\'s Horn');
  }

  const now = new Date();
  if (user.last_herald_horn_at && (now - new Date(user.last_herald_horn_at)) < 24 * 60 * 60 * 1000) {
    throw new Error('Cooldown: The Herald\'s Horn can only be used once every 24 hours');
  }

  // Record usage
  await fastify.db.query(
    `UPDATE users SET last_herald_horn_at = NOW() WHERE id = $1`,
    [userId]
  );

  // Emit to logs and prepare for global broadcast
  fastify.log.info({ userId, message }, 'Heralds Horn triggered!');
  
  // In a system with WebSockets, we would publish to Redis for all instances to broadcast
  if (fastify.redis) {
    await fastify.redis.publish('global_notifications', JSON.stringify({
      type: 'heralds_horn',
      userId,
      message,
      timestamp: now
    }));
  }

  return { success: true };
}

// Generate share card data (for frontend to render image)
export function generateShareCardData(user, tribe, stats) {
  const nationTemplates = {
    'england': { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', text: "I'm representing England on GoalMind's Global Arena." },
    'argentina': { flag: '🇦🇷', text: 'Los campeones del mundo representan en GoalMind también.' },
    'brazil': { flag: '🇧🇷', text: 'Brazil não perde no campo e não vai perder no GoalMind.' },
    'nigeria': { flag: '🇳🇬', text: 'Super Eagles fans — Nigeria needs you.' },
    'usa': { flag: '🇺🇸', text: 'The World Cup is in our backyard.' },
    'france': { flag: '🇫🇷', text: 'La France représente sur GoalMind.' },
    'germany': { flag: '🇩🇪', text: 'Deutschland kämpft im GoalMind-Weltcup.' },
  };
  
  const template = nationTemplates[tribe.slug] || { flag: '🏆', text: `I'm representing ${tribe.name} on GoalMind.` };
  const message = tribe.motto || template.text;
  
  return {
    flag: template.flag,
    tribeName: tribe.name,
    primaryColor: tribe.primary_color,
    secondaryColor: tribe.secondary_color,
    bannerUrl: tribe.banner_url,
    motto: tribe.motto,
    nationRank: stats.nationRank || '#--',
    battlesCount: stats.battlesCount || 0,
    referralCount: stats.referralCount || 0,
    message: message,
    messageExtra: `We're currently #${stats.nationRank || '?'} in the world. Think you know your football? Come prove it.`,
    webLink: stats.webLink,
    qrData: stats.referralCode,
  };
}

export default {
  generateReferralCode,
  buildReferralLink,
  parseReferralCode,
  recordReferralAttribution,
  checkAndAwardMilestoneRewards,
  resolveReferrerId,
  getTopRecruiters,
  getUserReferralStats,
  generateShareCardData, triggerHeraldsHorn,
};