
/**
 * Derby Window Service
 * Handles temporary multipliers and scheduling for tribal derbies.
 */

/**
 * Get all currently active derby windows
 * @param {Object} fastify Fastify instance
 * @param {string} tribeId Optional tribe ID to filter by
 * @returns {Promise<Array>}
 */
export async function getActiveDerbyWindows(fastify, tribeId = null) {
  try {
    const now = new Date();
    let query = `
      SELECT * FROM derby_windows 
      WHERE is_active = true 
      AND start_time <= $1 
      AND end_time >= $1
    `;
    const params = [now];

    if (tribeId) {
      query += ` AND (tribe_ids = '{}'::uuid[] OR $2 = ANY(tribe_ids))`;
      params.push(tribeId);
    }

    const result = await fastify.db.query(query, params);
    return result.rows;
  } catch (err) {
    fastify.log.error({ err }, 'Error fetching active derby windows');
    return [];
  }
}

/**
 * Get consolidated multipliers for active derby windows
 * @param {Object} fastify Fastify instance
 * @param {string} tribeId Optional tribe ID to filter by
 * @returns {Promise<Object>}
 */
export async function getDerbyMultipliers(fastify, tribeId = null) {
  const activeWindows = await getActiveDerbyWindows(fastify, tribeId);
  
  const multipliers = {
    goal_tokens: 1,
    tribe_honor: 1,
    founding_recruiter_bounty: 1
  };

  if (activeWindows.length === 0) return multipliers;

  // Use the highest multiplier if multiple windows overlap
  for (const window of activeWindows) {
    const m = window.multipliers || {};
    if (m.goal_tokens && m.goal_tokens > multipliers.goal_tokens) {
      multipliers.goal_tokens = m.goal_tokens;
    }
    if (m.tribe_honor && m.tribe_honor > multipliers.tribe_honor) {
      multipliers.tribe_honor = m.tribe_honor;
    }
    if (m.founding_recruiter_bounty && m.founding_recruiter_bounty > multipliers.founding_recruiter_bounty) {
      multipliers.founding_recruiter_bounty = m.founding_recruiter_bounty;
    }
  }

  return multipliers;
}

export default {
  getActiveDerbyWindows,
  getDerbyMultipliers
};
