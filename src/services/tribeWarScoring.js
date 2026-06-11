import config from '../config.js';
import { getDerbyMultipliers } from './derbyService.js';

/**
 * Tribe War Scoring Service
 * 
 * Handles scoring aggregation, rivalry alerts, and derby multipliers
 * for the Tribe War system.
 */

// European rivalry configuration
const defaultRivalries = {
  'real-madrid': ['barcelona', 'atletico-madrid'],
  'barcelona': ['real-madrid'],
  'liverpool': ['manchester-united'],
  'manchester-united': ['liverpool', 'manchester-city'],
  'manchester-city': ['manchester-united'],
  'chelsea': ['arsenal'],
  'arsenal': ['chelsea'],
  'bayern-munich': ['borussia-dortmund'],
  'juventus': ['inter-milan'],
  'ac-milan': ['inter-milan'],
};

// African Giants rivalry configuration (for Derby Day 2x boosters)
const africanRivalries = {
  'al-ahly': ['zamalek'],
  'zamalek': ['al-ahly'],
  'kaizer-chiefs': ['orlando-pirates'],
  'orlando-pirates': ['kaizer-chiefs'],
  'raja-casablanca': ['wydad-casablanca'],
  'wydad-casablanca': ['raja-casablanca'],
  'simba-sc': ['yanga-sc'],
  'yanga-sc': ['simba-sc'],
};

// Derby multiplier value (2x points for rivalry battles)
const DERBY_MULTIPLIER = 2;

// Active alerts cache (in production, use Redis)
const activeAlerts = new Map();

/**
 * Check if two tribes are rivals (European or African)
 */
export function areTribesRivals(tribe1Slug, tribe2Slug) {
  if (!tribe1Slug || !tribe2Slug) return false;
  // Check European rivalries
  const rivals1EU = defaultRivalries[tribe1Slug] || [];
  const rivals2EU = defaultRivalries[tribe2Slug] || [];
  if (rivals1EU.includes(tribe2Slug) || rivals2EU.includes(tribe1Slug)) return true;
  // Check African Giants rivalries
  const rivals1AF = africanRivalries[tribe1Slug] || [];
  const rivals2AF = africanRivalries[tribe2Slug] || [];
  return rivals1AF.includes(tribe2Slug) || rivals2AF.includes(tribe1Slug);
}

/**
 * Get rivalry multiplier for a battle
 * Returns 2 if rivalry battle, 1 otherwise
 */
export function getDerbyMultiplier(tribe1Slug, tribe2Slug) {
  return areTribesRivals(tribe1Slug, tribe2Slug) ? DERBY_MULTIPLIER : 1;
}

/**
 * Calculate tribe points with derby multiplier
 */
export function calculateTribePoints(basePoints, tribe1Slug, tribe2Slug) {
  const multiplier = getDerbyMultiplier(tribe1Slug, tribe2Slug);
  return Math.floor(basePoints * multiplier);
}

/**
 * Record a tribal battle result and update scores
 */
export async function recordTribalBattle(fastify, battleData) {
  const { 
    battleId, 
    winnerId, 
    winnerTribeId, 
    loserTribeId,
    winnerTribeSlug,
    loserTribeSlug,
    isRivalry,
    winnerCohort,
    loserCohort
  } = battleData;

  try {
    const multiplier = isRivalry ? DERBY_MULTIPLIER : 1;
    let basePoints = 10;

    // Legion Clash Weekend logic: Saturday(6) or Sunday(0)
    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const isVanguardCenturionClash = (winnerCohort === 'vanguard_500' && loserCohort === 'centurion') || 
                                     (winnerCohort === 'centurion' && loserCohort === 'vanguard_500');
    
    if (isWeekend && isVanguardCenturionClash) {
      basePoints = 30; // 3x Tribe Points
    }

    // Apply Derby Window Tribe Honor multipliers
    const derbyMultipliers = await getDerbyMultipliers(fastify, winnerTribeId);
    const pointsAwarded = Math.floor(basePoints * multiplier * derbyMultipliers.tribe_honor);

    // Update Redis scoring
    if (winnerTribeId) {
      // Increment tribe war score
      await fastify.redis.hincrby(`tribe_war:scores`, winnerTribeId, pointsAwarded);
      
      // Record battle in tribe war history
      const battleRecord = JSON.stringify({
        battleId,
        winnerTribeId,
        loserTribeId,
        pointsAwarded,
        isRivalry,
        timestamp: Date.now(),
      });
      await fastify.redis.lpush(`tribe_war:battles:${winnerTribeId}`, battleRecord);
      await fastify.redis.ltrim(`tribe_war:battles:${winnerTribeId}`, 0, 99); // Keep last 100
      
      // Check if this triggers a rivalry alert
      if (isRivalry) {
        await triggerRivalryAlert(fastify, winnerTribeId, winnerTribeSlug, loserTribeSlug, pointsAwarded);
      }
    }

    // Update global tribe war leaderboard in Redis
    if (winnerTribeId) {
      const score = await fastify.redis.zscore('leaderboard:tribal', winnerTribeId);
      await fastify.redis.zadd('leaderboard:tribal', parseInt(score || 0) + pointsAwarded, winnerTribeId);
    }

    return { pointsAwarded, multiplier, isRivalry };
  } catch (err) {
    fastify.log.error('Error recording tribal battle:', err);
    return { pointsAwarded: basePoints, multiplier: 1, isRivalry: false };
  }
}

/**
 * Trigger a rivalry alert when a tribe scores against a rival
 */
async function triggerRivalryAlert(fastify, winnerTribeId, winnerTribeSlug, loserTribeSlug, pointsEarned) {
  try {
    // Get rival tribe ID from slug
    const rivalSlug = loserTribeSlug;
    const rivalResult = await fastify.db.query(
      'SELECT id, name FROM tribes WHERE slug = $1',
      [rivalSlug]
    );
    
    if (rivalResult.rows.length === 0) return;
    
    const rivalTribeId = rivalResult.rows[0].id;
    
    // Create alert
    const alert = {
      id: `alert_${Date.now()}`,
      type: 'rivalry_alert',
      tribeId: rivalTribeId,
      rivalTribeId: winnerTribeId,
      rivalTribeSlug: winnerTribeSlug,
      pointsAgainstRival: pointsEarned,
      timestamp: Date.now(),
      ttl: 60 * 60 * 1000, // 1 hour
    };

    // Store in Redis with expiry
    await fastify.redis.setex(
      `tribe_war:alert:${rivalTribeId}:${winnerTribeSlug}`,
      3600,
      JSON.stringify(alert)
    );

    // Publish to Socket.IO namespace if connected users from this tribe
    const subscribers = await fastify.redis.smembers(`tribe_war:subscribers:${rivalTribeId}`);
    if (subscribers.length > 0 && fastify.io) {
      const battleNamespace = fastify.io.of('/battle');
      subscribers.forEach(socketId => {
        battleNamespace.to(socketId).emit('tribe_war:alert', alert);
      });
    }

    // Track active alerts
    const key = `${rivalTribeId}:${winnerTribeSlug}`;
    activeAlerts.set(key, alert);

    // Auto-expire after TTL
    setTimeout(() => {
      activeAlerts.delete(key);
    }, alert.ttl);

    fastify.log.info(`Rivalry alert triggered: ${winnerTribeSlug} scored ${pointsEarned} points against ${loserTribeSlug}`);
  } catch (err) {
    fastify.log.error('Error triggering rivalry alert:', err);
  }
}

/**
 * Get pending rivalry alerts for a tribe
 */
export async function getRivalryAlerts(fastify, tribeId) {
  try {
    const alerts = [];
    
    // Scan Redis for relevant alerts
    const keys = await fastify.redis.keys(`tribe_war:alert:${tribeId}:*`);
    
    for (const key of keys) {
      const alertData = await fastify.redis.get(key);
      if (alertData) {
        alerts.push(JSON.parse(alertData));
      }
    }
    
    // Sort by timestamp descending
    alerts.sort((a, b) => b.timestamp - a.timestamp);
    
    return alerts;
  } catch (err) {
    fastify.log.error('Error getting rivalry alerts:', err);
    return [];
  }
}

/**
 * Get tribe war scoring aggregates
 */
export async function getTribeWarScores(fastify, timeWindowHours = 24) {
  try {
    const tribes = await fastify.db.query('SELECT id, name, slug, primary_color, secondary_color FROM tribes');
    const scores = {};
    
    for (const tribe of tribes.rows) {
      // Get score from Redis
      const redisScore = await fastify.redis.hget('tribe_war:scores', tribe.id);
      const score = parseInt(redisScore || 0);
      
      if (score > 0) {
        // Get recent battles
        const battleKeys = await fastify.redis.lrange(`tribe_war:battles:${tribe.id}`, 0, -1);
        const recentBattles = battleKeys.map(k => JSON.parse(k)).slice(0, 10);
        
        const rivalryBattles = recentBattles.filter(b => b.isRivalry);
        
        scores[tribe.id] = {
          tribeId: tribe.id,
          name: tribe.name,
          slug: tribe.slug,
          totalPoints: score,
          totalBattles: battleKeys.length,
          rivalryBattles: rivalryBattles.length,
          recentBattles: recentBattles.slice(0, 5),
        };
      }
    }
    
    return Object.values(scores).sort((a, b) => b.totalPoints - a.totalPoints);
  } catch (err) {
    fastify.log.error('Error getting tribe war scores:', err);
    return [];
  }
}

/**
 * Get derby history between two rival tribes
 */
export async function getDerbyHistory(fastify, tribe1Slug, tribe2Slug) {
  try {
    const tribe1Result = await fastify.db.query('SELECT id FROM tribes WHERE slug = $1', [tribe1Slug]);
    const tribe2Result = await fastify.db.query('SELECT id FROM tribes WHERE slug = $1', [tribe2Slug]);
    
    if (tribe1Result.rows.length === 0 || tribe2Result.rows.length === 0) {
      return { tribe1: null, tribe2: null, battles: [], stats: null };
    }
    
    const tribe1Id = tribe1Result.rows[0].id;
    const tribe2Id = tribe2Result.rows[0].id;
    
    // Get battles between these tribes
    const battlesResult = await fastify.db.query(
      `SELECT b.*, 
              u1.tribe_id as winner_tribe_id,
              u2.tribe_id as loser_tribe_id
       FROM battles b
       JOIN users u1 ON b.winner_id = u1.id
       JOIN users u2 ON (b.player1_id = u2.id OR b.player2_id = u2.id) AND u2.id != b.winner_id
       WHERE (u1.tribe_id = $1 AND u2.tribe_id = $2)
          OR (u1.tribe_id = $2 AND u2.tribe_id = $1)
       ORDER BY b.created_at DESC
       LIMIT 50`,
      [tribe1Id, tribe2Id]
    );
    
    // Calculate stats
    const tribe1Wins = battlesResult.rows.filter(b => b.winner_tribe_id === tribe1Id).length;
    const tribe2Wins = battlesResult.rows.filter(b => b.winner_tribe_id === tribe2Id).length;
    
    return {
      tribe1: tribe1Slug,
      tribe2: tribe2Slug,
      battles: battlesResult.rows,
      stats: {
        totalBattles: battlesResult.rows.length,
        tribe1Wins,
        tribe2Wins,
        draws: battlesResult.rows.length - tribe1Wins - tribe2Wins,
        isRivalry: areTribesRivals(tribe1Slug, tribe2Slug),
        multiplier: DERBY_MULTIPLIER,
      },
    };
  } catch (err) {
    fastify.log.error('Error getting derby history:', err);
    return { tribe1: tribe1Slug, tribe2: tribe2Slug, battles: [], stats: null, error: err.message };
  }
}

/**
 * Subscribe a socket to tribe war alerts
 */
export async function subscribeToTribeWarAlerts(fastify, tribeId, socketId) {
  try {
    await fastify.redis.sadd(`tribe_war:subscribers:${tribeId}`, socketId);
    return true;
  } catch (err) {
    fastify.log.error('Error subscribing to tribe war alerts:', err);
    return false;
  }
}

/**
 * Unsubscribe from tribe war alerts
 */
export async function unsubscribeFromTribeWarAlerts(fastify, tribeId, socketId) {
  try {
    await fastify.redis.srem(`tribe_war:subscribers:${tribeId}`, socketId);
    return true;
  } catch (err) {
    fastify.log.error('Error unsubscribing from tribe war alerts:', err);
    return false;
  }
}

/**
 * Get derby multiplier value
 */
export function getDerbyMultiplierValue() {
  return DERBY_MULTIPLIER;
}

// Re-export getActiveWars from tribeWarService for convenience
export { getActiveWars } from './tribeWarService.js';

/**
 * Check if a matchup is a derby (rivalry)
 */
export function isDerby(tribe1Slug, tribe2Slug) {
  return areTribesRivals(tribe1Slug, tribe2Slug);
}

/**
 * Get all configured rivalries
 */
export function getConfiguredRivalries() {
  return { ...defaultRivalries };
}

export default {
  areTribesRivals,
  getDerbyMultiplier,
  calculateTribePoints,
  recordTribalBattle,
  getRivalryAlerts,
  getTribeWarScores,
  getDerbyHistory,
  subscribeToTribeWarAlerts,
  unsubscribeFromTribeWarAlerts,
  getDerbyMultiplierValue,
  isDerby,
  getConfiguredRivalries,
};