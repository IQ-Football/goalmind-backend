/**
 * Streak & Rank-Weighted Decay Service — "No Idle Champions"
 * 
 * Implements:
 * - Rank-weighted ELO decay based on 10-tier system
 * - Tier-specific grace periods before decay starts
 * - Blitz Buffer (5 ranked matches in 24h → 3 days immunity)
 * - Weekend Warrior (10 wins Fri-Sun → 5 days immunity)
 * - Decay floor = tier minimum ELO
 * - Immunity stacking up to 14 days max
 */

import { getTierForElo, getTierFloor, getStreakReward } from './iqStatusService.js';

// ─── DECAY RATE TABLE (from RETENTION_MECHANICS.md) ──────────────────────────

export const DECAY_CONFIG = {
  1:  { graceDays: 14,  decayPerDay: 0   },  // Amateur
  2:  { graceDays: 14,  decayPerDay: 0   },  // Supporter
  3:  { graceDays: 14,  decayPerDay: 0   },  // Ultra
  4:  { graceDays: 14,  decayPerDay: 0   },  // Regional Hero
  5:  { graceDays: 14,  decayPerDay: 0   },  // National Talent
  6:  { graceDays: 14,  decayPerDay: 0   },  // Continental Pro
  7:  { graceDays: 3,   decayPerDay: 10  },  // World Class (Continental Premier)
  8:  { graceDays: 3,   decayPerDay: 10  },  // Elite Tactician (Continental Premier)
  9:  { graceDays: 3,   decayPerDay: 25  },  // Legend (Global Arena)
  10: { graceDays: 3,   decayPerDay: 25  },  // GOAT (Global Arena)
};

// Max immunity stacking
const MAX_IMMUNITY_DAYS = 14;

// ─── RECORD ACTIVITY ──────────────────────────────────────────────────────────

export async function recordActivity(fastify, userId, matchResult = 'played') {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const userResult = await fastify.db.query(
      'SELECT last_active_at, streak_days, decay_immunity_days, blitz_buffer_active FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return null;
    
    const user = userResult.rows[0];
    const lastActive = user.last_active_at ? new Date(user.last_active_at) : null;
    const currentStreak = user.streak_days || 0;
    
    // Update streak
    let newStreakDays = 1;
    let streakBroken = false;
    
    if (lastActive) {
      const daysDiff = Math.floor((Date.now() - lastActive) / 86400000);
      if (daysDiff === 0) {
        newStreakDays = currentStreak;
      } else if (daysDiff === 1) {
        newStreakDays = currentStreak + 1;
      } else {
        newStreakDays = 1;
        streakBroken = currentStreak > 3; // only flag meaningful streaks
      }
    }
    
    // Check for Blitz Buffer: 5+ ranked matches in last 24h
    const recentBattles = await fastify.db.query(
      `SELECT COUNT(*) as count FROM battles
       WHERE (player1_id = $1 OR player2_id = $1)
         AND status = 'completed'
         AND started_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    const battlesLast24h = Number(recentBattles.rows[0].count) || 0;
    const blitzBufferActive = battlesLast24h >= 5;
    
    // Update decay immunity
    let newImmunityDays = Number(user.decay_immunity_days) || 0;
    if (blitzBufferActive && matchResult === 'win') {
      // Blitz Buffer: 3 days immunity
      newImmunityDays = Math.min(newImmunityDays + 3, MAX_IMMUNITY_DAYS);
    }
    
    // Update user
    await fastify.db.query(
      `UPDATE users 
       SET last_active_at = NOW(), 
           streak_days = $1,
           decay_immunity_days = $2,
           blitz_buffer_active = $3,
           status = 'active'
       WHERE id = $4`,
      [newStreakDays, newImmunityDays, blitzBufferActive, userId]
    );
    
    // Cache in Redis
    await fastify.redis.hset(`user:${userId}:streak`, 
      'streak', newStreakDays, 
      'lastActivity', today,
      'immunityDays', newImmunityDays,
      'blitzBuffer', blitzBufferActive ? '1' : '0'
    );
    await fastify.redis.expire(`user:${userId}:streak`, 86400 * 60);
    
    // Award streak rewards if streak milestone reached
    const reward = getStreakReward(newStreakDays);
    
    return {
      streakDays: newStreakDays,
      streakBroken,
      previousStreak: currentStreak,
      today,
      blitzBufferActive,
      decayImmunityDays: newImmunityDays,
      streakReward: reward,
    };
  } catch (err) {
    fastify.log.error('recordActivity error:', err);
    return null;
  }
}

// ─── WEEKEND WARRIOR CHECK ────────────────────────────────────────────────────

export async function checkWeekendWarrior(fastify, userId) {
  try {
    // Friday 00:00 to Sunday 23:59
    const now = new Date();
    const dow = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
    
    if (dow !== 5 && dow !== 6 && dow !== 0) return null; // Not a weekend
    
    const friStart = new Date(now);
    friStart.setDate(friStart.getDate() - ((dow + 2) % 7));
    friStart.setHours(0, 0, 0, 0);
    
    const sunEnd = new Date(friStart);
    sunEnd.setDate(friStart.getDate() + 2);
    sunEnd.setHours(23, 59, 59, 999);
    
    const winsResult = await fastify.db.query(
      `SELECT COUNT(*) as count FROM battles
       WHERE (winner_id = $1)
         AND started_at BETWEEN $2 AND $3`,
      [userId, friStart, sunEnd]
    );
    
    const winsThisWeekend = Number(winsResult.rows[0].count) || 0;
    if (winsThisWeekend >= 10) {
      const newImmunityDays = Math.min(
        Number((await fastify.db.query('SELECT decay_immunity_days FROM users WHERE id = $1', [userId])).rows[0]?.decay_immunity_days || 0) + 5,
        MAX_IMMUNITY_DAYS
      );
      await fastify.db.query(
        'UPDATE users SET decay_immunity_days = $1 WHERE id = $2',
        [newImmunityDays, userId]
      );
      return { weekendWarrior: true, immunityDays: 5 };
    }
    return { weekendWarrior: false, winsThisWeekend };
  } catch (err) {
    fastify.log.error('checkWeekendWarrior error:', err);
    return null;
  }
}

// ─── GET TIER DECAY INFO ───────────────────────────────────────────────────────

export function getTierDecayInfo(elo) {
  const tier = getTierForElo(elo);
  const config = DECAY_CONFIG[tier.tier] || DECAY_CONFIG[1];
  const floor = getTierFloor(tier.tier);
  return {
    tier: tier.tier,
    tierName: tier.name,
    graceDays: config.graceDays,
    graceHours: Math.round(config.graceDays * 24),
    decayPerDay: config.decayPerDay,
    floor,
  };
}

// ─── APPLY USER DECAY ─────────────────────────────────────────────────────────

export async function applyUserDecay(fastify, userId) {
  const userResult = await fastify.db.query(
    'SELECT elo, last_active_at, decay_immunity_days FROM users WHERE id = $1',
    [userId]
  );
  if (userResult.rows.length === 0) return { decayed: false, reason: 'user_not_found' };
  
  const { elo, last_active_at, decay_immunity_days } = userResult.rows[0];
  
  // Check immunity
  const immunityDays = Number(decay_immunity_days) || 0;
  if (immunityDays > 0) {
    return { decayed: false, reason: 'immune', immunityDaysRemaining: immunityDays };
  }
  
  const inactiveDays = last_active_at
    ? Math.floor((Date.now() - new Date(last_active_at)) / 86400000)
    : 999;
  
  const decayInfo = getTierDecayInfo(elo);
  
  // Within grace period?
  if (inactiveDays < decayInfo.graceDays) {
    return { decayed: false, reason: 'within_grace', graceDays: decayInfo.graceDays, inactiveDays };
  }
  
  // At floor?
  if (elo <= decayInfo.floor) {
    await fastify.db.query(
      `UPDATE users SET status = 'dormant' WHERE id = $1`,
      [userId]
    );
    return { decayed: false, reason: 'at_floor', floor: decayInfo.floor };
  }
  
  // Apply decay
  const decayAmount = Math.min(decayInfo.decayPerDay, elo - decayInfo.floor);
  const newElo = Math.max(elo - decayAmount, decayInfo.floor);
  
  await fastify.db.query(
    `UPDATE users SET elo = $1, status = $2 WHERE id = $3`,
    [newElo, decayInfo.tierName.toLowerCase().replace(' ', '_'), userId]
  );
  
  // Update Redis leaderboard
  await fastify.redis.zadd('leaderboard:global', newElo, userId);
  
  return {
    decayed: true,
    oldElo: elo,
    newElo,
    decayAmount,
    tier: decayInfo.tierName,
    inactiveDays,
    decayPerDay: decayInfo.decayPerDay,
  };
}

// ─── DAILY DECAY JOB ─────────────────────────────────────────────────────────

export async function runDailyDecayJob(fastify) {
  const results = { processed: 0, decayed: 0, totalEloLost: 0, immune: 0, atFloor: 0, errors: 0 };
  
  try {
    // Find users past grace period who aren't immune
    const usersResult = await fastify.db.query(
      `SELECT u.id, u.elo, u.last_active_at, u.decay_immunity_days
       FROM users u
       WHERE u.elo > 0
         AND (u.decay_immunity_days IS NULL OR u.decay_immunity_days = 0)
         AND (
           u.last_active_at IS NULL 
           OR (NOW() - u.last_active_at) > INTERVAL '1 day'
         )`
    );
    
    for (const row of usersResult.rows) {
      try {
        const result = await applyUserDecay(fastify, row.id);
        results.processed++;
        if (result.decayed) {
          results.decayed++;
          results.totalEloLost += result.decayAmount;
        } else if (result.reason === 'immune') {
          results.immune++;
        } else if (result.reason === 'at_floor') {
          results.atFloor++;
        }
      } catch (err) {
        results.errors++;
      }
    }
    
    // Decay immunity by 1 day for all users with immunity
    await fastify.db.query(
      `UPDATE users SET decay_immunity_days = GREATEST(decay_immunity_days - 1, 0) WHERE decay_immunity_days > 0`
    );
    
    // Cache last run
    await fastify.redis.setex('decay:last_run', 86400, JSON.stringify({
      timestamp: new Date().toISOString(),
      ...results,
    }));
    
    fastify.log.info(`Decay job: ${results.processed} processed, ${results.decayed} decayed (${results.totalEloLost} ELO), ${results.immune} immune, ${results.errors} errors`);
    return results;
  } catch (err) {
    fastify.log.error('Daily decay job failed:', err);
    return results;
  }
}

// ─── USER STATUS REPORT ────────────────────────────────────────────────────────

export async function getUserStatusReport(fastify, userId) {
  const userResult = await fastify.db.query(
    `SELECT u.id, u.username, u.elo, u.streak_days, u.last_active_at, 
            u.title, u.status, u.decay_immunity_days, u.blitz_buffer_active,
            u.contribution_points,
            t.name as tribe_name, t.slug as tribe_slug
     FROM users u
     LEFT JOIN tribes t ON u.tribe_id = t.id
     WHERE u.id = $1`,
    [userId]
  );
  
  if (userResult.rows.length === 0) return null;
  
  const user = userResult.rows[0];
  const tier = getTierForElo(user.elo);
  const decayInfo = getTierDecayInfo(user.elo);
  
  const globalRank = await fastify.redis.zrevrank('leaderboard:global', userId);
  const totalUsers = await fastify.redis.zcard('leaderboard:global');
  
  const inactiveDays = user.last_active_at
    ? Math.floor((Date.now() - new Date(user.last_active_at)) / 86400000)
    : 999;
  
  const streakReward = getStreakReward(user.streak_days || 0);
  const immunityDays = Number(user.decay_immunity_days) || 0;
  
  return {
    userId: user.id,
    username: user.username,
    elo: user.elo,
    tier: { number: tier.tier, name: tier.name, icon: tier.icon, color: tier.color },
    globalRank: globalRank !== null ? globalRank + 1 : null,
    totalUsers,
    percentile: globalRank !== null 
      ? Number(((totalUsers - globalRank - 1) / totalUsers * 100).toFixed(1))
      : null,
    streak: {
      currentDays: user.streak_days || 0,
      multiplier: streakReward.multiplier,
      flair: streakReward.flair,
    },
    decay: {
      inactiveDays,
      tier: decayInfo.tierName,
      graceDays: decayInfo.graceDays,
      graceHours: decayInfo.graceHours,
      decayPerDay: decayInfo.decayPerDay,
      isDecaying: decayInfo.decayPerDay > 0 && inactiveDays >= decayInfo.graceDays,
      isImmune: immunityDays > 0,
      immunityDaysRemaining: immunityDays,
      floor: decayInfo.floor,
    },
    blitzBuffer: user.blitz_buffer_active === true,
    weekendWarrior: false, // computed async if needed
    status: user.status || 'active',
    title: user.title || 'Recruit',
    tribe: { name: user.tribe_name, slug: user.tribe_slug },
    lastActive: user.last_active_at,
    contributionPoints: Number(user.contribution_points) || 0,
  };
}

// ─── SCHEDULER ────────────────────────────────────────────────────────────────

export function startDecayScheduler(fastify) {
  // Run once on startup
  setTimeout(() => {
    runDailyDecayJob(fastify).catch(err => fastify.log.error('Startup decay run error:', err));
  }, 5000);
  
  const interval = setInterval(() => {
    runDailyDecayJob(fastify).catch(err => fastify.log.error('Daily decay job error:', err));
  }, 86400000); // 24h
  
  fastify.log.info('Decay scheduler started (24h interval)');
  return interval;
}