import config from '../config.js';

/**
 * Tribe War Service
 * 
 * Handles rivalry-based battles with 2x tribe point multipliers during
 * Tribe War events (48-hour windows for rival matchups).
 */

// Store active tribe war windows (in production, use Redis)
const activeTribeWars = new Map();

// Rivalry configuration (would come from DB in production)
const defaultRivalries = {
  'real-madrid': ['barcelona', 'atletico-madrid'],
  'barcelona': ['real-madrid'],
  'liverpool': ['manchester-united'],
  'manchester-united': ['liverpool', 'manchester-city'],
  'manchester-city': ['manchester-united'],
  'chelsea': ['arsenal'],
  'arsenal': ['chelsea'],
  'bayern-munich': ['borussia-dortmund'],
};

/**
 * Check if two tribes are rivals
 */
export function areTribesRivals(tribe1Slug, tribe2Slug) {
  const rivals1 = defaultRivalries[tribe1Slug] || [];
  const rivals2 = defaultRivalries[tribe2Slug] || [];
  return rivals1.includes(tribe2Slug) || rivals2.includes(tribe1Slug);
}

/**
 * Calculate tribe points with rivalry multiplier
 */
export function calculateTribePoints(basePoints, tribe1Slug, tribe2Slug) {
  if (areTribesRivals(tribe1Slug, tribe2Slug)) {
    return Math.floor(basePoints * 2);
  }
  return basePoints;
}

/**
 * Get active tribe war for a rivalry pair
 */
export async function getActiveTribeWar(tribe1Id, tribe2Id, fastify) {
  const warKey = [tribe1Id, tribe2Id].sort().join(':');
  
  // Try Redis first for distributed consistency
  if (fastify?.redis) {
    const warData = await fastify.redis.get(`tribe_war:${warKey}`);
    if (warData) return JSON.parse(warData);
  }
  
  return null;
}

/**
 * Start a tribe war event (48 hours)
 */
export function startTribeWar(tribe1Id, tribe2Id, fastify) {
  const warKey = [tribe1Id, tribe2Id].sort().join(':');
  const war = {
    id: `tw_${warKey}`,
    tribe1Id,
    tribe2Id,
    startTime: Date.now(),
    endTime: Date.now() + (48 * 60 * 60 * 1000), // 48 hours
    multiplier: 2,
    status: 'active',
  };
  
  activeTribeWars.set(warKey, war);
  
  // Store in Redis for distributed access
  if (fastify?.redis) {
    fastify.redis.setex(`tribe_war:${warKey}`, 48 * 60 * 60, JSON.stringify(war));
  }
  
  return war;
}

/**
 * Check if a tribe war is currently active
 */
export function isTribeWarActive(tribe1Id, tribe2Id) {
  const warKey = [tribe1Id, tribe2Id].sort().join(':');
  const war = activeTribeWars.get(warKey);
  
  if (!war) return false;
  return war.endTime > Date.now();
}

/**
 * Get tribe war leaderboard (rivalry battles won)
 */
export async function getTribeWarLeaderboard(fastify, limit = 50) {
  try {
    const result = await fastify.db.query(
      `SELECT 
        t.id as tribe_id,
        t.name,
        t.slug,
        t.primary_color,
        t.secondary_color,
        COUNT(CASE WHEN b.status = 'completed' AND b.tribe_points_awarded > 0 
          AND t.id IN (
            SELECT tribe_id FROM users WHERE id = b.player1_id
              UNION 
            SELECT tribe_id FROM users WHERE id = b.player2_id
          ) THEN 1 END) as war_victories
       FROM tribes t
       LEFT JOIN users u ON u.tribe_id = t.id
       LEFT JOIN battles b ON (b.player1_id = u.id OR b.player2_id = u.id) 
         AND b.status = 'completed'
       WHERE t.type = 'club'
       GROUP BY t.id, t.name, t.slug, t.primary_color, t.secondary_color
       ORDER BY war_victories DESC
       LIMIT $1`,
      [limit]
    );
    
    return result.rows;
  } catch (err) {
    fastify.log.error('Error fetching tribe war leaderboard:', err);
    return [];
  }
}

/**
 * Get rivalry status for a tribe
 */
export async function getTribeRivalries(fastify, tribeId) {
  try {
    const tribeResult = await fastify.db.query(
      'SELECT rival_tribe_ids FROM tribes WHERE id = $1',
      [tribeId]
    );
    
    if (tribeResult.rows.length === 0) return null;
    
    const rivalIds = tribeResult.rows[0].rival_tribe_ids || [];
    
    if (rivalIds.length === 0) {
      // Fall back to slug-based rivalries
      const tribeSlug = tribeResult.rows[0].slug;
      const rivalSlugs = defaultRivalries[tribeSlug] || [];
      
      if (rivalSlugs.length === 0) return { tribeId, rivals: [], activeWars: [] };
      
      const rivalsResult = await fastify.db.query(
        'SELECT id, name, slug, primary_color, secondary_color FROM tribes WHERE slug = ANY($1)',
        [rivalSlugs]
      );
      
      return {
        tribeId,
        tribeSlug,
        rivals: rivalsResult.rows,
        activeWars: [], // Would check Redis for active wars
      };
    }
    
    // Get rival tribe details
    const rivalsResult = await fastify.db.query(
      'SELECT id, name, slug, primary_color, secondary_color FROM tribes WHERE id = ANY($1)',
      [rivalIds]
    );
    
    return {
      tribeId,
      rivals: rivalsResult.rows,
      activeWars: [], // Would check Redis for active wars
    };
  } catch (err) {
    fastify.log.error('Error fetching rivalries:', err);
    return null;
  }
}

/**
 * Get current war status for all rivalries
 */
export async function getActiveWars(fastify) {
  const wars = [];
  
  if (fastify?.redis) {
    const keys = await fastify.redis.keys('tribe_war:*');
    for (const key of keys) {
      const warData = await fastify.redis.get(key);
      if (warData) {
        const war = JSON.parse(warData);
        if (war.endTime > Date.now()) {
          wars.push(war);
        }
      }
    }
  }
  
  return wars;
}

export default {
  areTribesRivals,
  calculateTribePoints,
  getActiveTribeWar,
  startTribeWar,
  isTribeWarActive,
  getTribeWarLeaderboard,
  getTribeRivalries,
  getActiveWars,
};