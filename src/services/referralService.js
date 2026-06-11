/**
 * Referral Service — The Recruitment Drive
 * Generates unique referral links, tracks attribution, processes milestone rewards
 */

import crypto from 'crypto';
import { awardBadge, awardBadgeWithTribeCap, awardBadgeWithGlobalCap, FOUNDING_GENERAL_ID, FOUNDING_PRO_ID, FOUNDING_RECRUITER_ID, FOUNDING_CAPTAIN_ID, FOUNDING_THRESHOLD } from './achievementService.js';

// Referral link prefix (used as deep link base)
const REFERRAL_PREFIX = 'goalmind://referral';
const WEB_REFERRAL_BASE = process.env.APP_URL || 'http://www.goalmind.app';

// Whale Hunter Thresholds
const SILVER_ORACLE_THRESHOLD = 5000;
const GOLD_ORACLE_THRESHOLD = 10000;
const OBSIDIAN_ORACLE_THRESHOLD = 20000;

const SILVER_ORACLE_GT_BONUS = 5000;
const GOLD_ORACLE_GT_BONUS = 15000;
const OBSIDIAN_ORACLE_GT_BONUS = 50000;

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
    webLink: `${WEB_REFERRAL_BASE}/join?ref=${referralCode}&tribe=${tribeId}&utm_source=${utmSource}&utm_campaign=${utmCampaign}`,
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

// Referral attribution record (stored when user joins via referral)
export async function recordReferralAttribution(fastify, { referrerId, recruitId, referralCode, tribeId, source }) {
  try {
    const id = crypto.randomUUID();
    
    await fastify.db.query(
      `INSERT INTO referrals (id, referrer_id, recruit_id, referral_code, tribe_id, source, status, created_at, converted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'joined', NOW(), NOW())`,
      [id, referrerId, recruitId, referralCode, tribeId, source || 'direct']
    );
    
    // Update referrer's referral count
    await fastify.db.query(
      `UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = $1`,
      [referrerId]
    );
    
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
  const { referral_count = 0, oracle_status = null } = await fastify.db.query(
    `SELECT referral_count, oracle_status FROM users WHERE id = $1`,
    [referrerId]
  ).then(r => r.rows[0] || {}).catch(() => ({ referral_count: 0, oracle_status: null }));
  
  const rewards = [];
  
  // Milestone 1: Recruit joined same tribe
  if (milestone === 'joined' && recruitId) {
    rewards.push({ type: 'nation_points', amount: 500, label: 'Referral join bonus' });
    
    // Credit 500 Nation Points to referrer
    await fastify.db.query(
      `UPDATE users SET nation_points = COALESCE(nation_points, 0) + 500 WHERE id = $1`,
      [referrerId]
    );
    
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
    
    // Credit 200 IQ Coins to recruit
    let rewardGems = 200;
    const hasAresSurgeRes = await fastify.db.query(
      "SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = '4b6c8914-87be-47ea-8942-d64e9a8f2765'",
      [recruitId]
    );
    if (hasAresSurgeRes.rows.length > 0) {
      rewardGems = Math.round(rewardGems * 1.2);
    }

    await fastify.db.query(
      `UPDATE users SET gems = COALESCE(gems, 0) + $1 WHERE id = $2`,
      [rewardGems, recruitId]
    );
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
    
    // Credit 500 IQ Coins to recruit
    if (recruitId) {
      await fastify.db.query(
        `UPDATE users SET gems = COALESCE(gems, 0) + 500 WHERE id = $1`,
        [recruitId]
      );
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

  // Whale Hunter Tiers (5,000, 10,000, 20,000 referrals)
  
  // Milestone 6: Silver Oracle (5,000 referrals)
  if (referral_count >= 5000 && oracle_status !== 'silver' && oracle_status !== 'gold' && oracle_status !== 'obsidian') {
    rewards.push({ type: 'oracle_status', status: 'silver', label: 'Silver Oracle status' });
    await fastify.db.query(
      `UPDATE users SET oracle_status = 'silver', goal_tokens = COALESCE(goal_tokens, 0) + 5000 WHERE id = $1`,
      [referrerId]
    );
    // Award Silver Oracle badge
    await fastify.db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at) 
       SELECT $1, id, NOW() FROM badges WHERE slug = 'silver_oracle' AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = (SELECT id FROM badges WHERE slug = 'silver_oracle'))`,
      [referrerId]
    );
  }

  // Milestone 7: Gold Oracle (10,000 referrals)
  if (referral_count >= 10000 && oracle_status !== 'gold' && oracle_status !== 'obsidian') {
    rewards.push({ type: 'oracle_status', status: 'gold', label: 'Gold Oracle status' });
    await fastify.db.query(
      `UPDATE users SET oracle_status = 'gold', goal_tokens = COALESCE(goal_tokens, 0) + 15000 WHERE id = $1`,
      [referrerId]
    );
    // Award Gold Oracle badge
    await fastify.db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at) 
       SELECT $1, id, NOW() FROM badges WHERE slug = 'gold_oracle' AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = (SELECT id FROM badges WHERE slug = 'gold_oracle'))`,
      [referrerId]
    );
  }

  // Milestone 8: Obsidian Oracle (20,000 referrals)
  if (referral_count >= 20000 && oracle_status !== 'obsidian') {
    rewards.push({ type: 'oracle_status', status: 'obsidian', label: 'Obsidian Oracle status' });
    await fastify.db.query(
      `UPDATE users SET oracle_status = 'obsidian', goal_tokens = COALESCE(goal_tokens, 0) + 50000 WHERE id = $1`,
      [referrerId]
    );
    // Award Obsidian Oracle badge and Herald's Horn
    await fastify.db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at) 
       SELECT $1, id, NOW() FROM badges WHERE slug = 'obsidian_oracle' AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = (SELECT id FROM badges WHERE slug = 'obsidian_oracle'))`,
      [referrerId]
    );
    await fastify.db.query(
      `INSERT INTO user_badges (user_id, badge_id, awarded_at) 
       SELECT $1, id, NOW() FROM badges WHERE slug = 'herald_horn' AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = (SELECT id FROM badges WHERE slug = 'herald_horn'))`,
      [referrerId]
    );
  }
  
  if (rewards.length > 0) {
    fastify.log.info({ referrerId, milestone, rewards }, 'Milestone rewards awarded');
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
    `SELECT referral_count, nation_points, title, oracle_status FROM users WHERE id = $1`,
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
                count < 50 ? 'Reach 50 recruits for Founding General' : 
                count < 5000 ? 'Reach 5,000 recruits for Silver Oracle' :
                count < 10000 ? 'Reach 10,000 recruits for Gold Oracle' :
                count < 20000 ? 'Reach 20,000 recruits for Obsidian Oracle' : 'Max Oracle status reached',
    foundingRecruiterProgress: Math.min(100, (count / 5) * 100),
    tribeGeneralProgress: Math.min(100, (count / 10) * 100),
    nationalHeroProgress: Math.min(100, (count / 25) * 100),
    foundingGeneralProgress: Math.min(100, (count / 50) * 100),
    silverOracleProgress: Math.min(100, (count / 5000) * 100),
    goldOracleProgress: Math.min(100, (count / 10000) * 100),
    obsidianOracleProgress: Math.min(100, (count / 20000) * 100),
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
  getTopRecruiters,
  getUserReferralStats,
  generateShareCardData,
};