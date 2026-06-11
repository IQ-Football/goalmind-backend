/**
 * Legacy XP Service
 * Handles conversion of GoalTokens to Legacy XP and Arena Level management.
 */

export const GT_XP_CONVERSION_RATE = 1; // 1 GT = 1 Legacy XP
export const XP_PER_ARENA_LEVEL = 1000;
export const CARRYOVER_CAP = 5000;

/**
 * Convert a specific amount of GoalTokens to Legacy XP for a user.
 * @param {Object} fastify Fastify instance
 * @param {string} userId User UUID
 * @param {number} amount Amount of GoalTokens to convert
 */
export async function convertTokensToLegacyXP(fastify, userId, amount) {
  if (amount <= 0) return { success: false, error: 'Amount must be positive' };

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify user balance
    const userRes = await client.query(
      'SELECT goal_tokens, legacy_xp, arena_level FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const user = userRes.rows[0];
    if (!user) throw new Error('User not found');

    if (user.goal_tokens < amount) {
      throw new Error('Insufficient GoalToken balance');
    }

    // 2. Calculate new values
    const newGT = user.goal_tokens - amount;
    const newXP = (user.legacy_xp || 0) + (amount * GT_XP_CONVERSION_RATE);
    const newLevel = Math.floor(newXP / XP_PER_ARENA_LEVEL) + 1;

    // 3. Update user
    await client.query(
      `UPDATE users SET 
        goal_tokens = $1, 
        legacy_xp = $2, 
        arena_level = $3,
        last_active_at = NOW()
       WHERE id = $4`,
      [newGT, newXP, newLevel, userId]
    );

    // 4. Record transaction
    await client.query(
      `INSERT INTO gem_transactions (user_id, amount, currency, provider, reference, type, created_at)
       VALUES ($1, $2, 'GOALTOKEN', 'system', $3, 'legacy_conversion', NOW())`,
      [userId, amount, `LEGACY_CONV_${Date.now()}`]
    );

    await client.query('COMMIT');
    return { 
      success: true, 
      convertedAmount: amount,
      newBalance: newGT,
      newXP,
      newLevel,
      levelUp: newLevel > (user.arena_level || 1)
    };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId, amount }, 'Error converting tokens to Legacy XP');
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Automatically convert excess tokens (above cap) to Legacy XP.
 * Usually called after rewards or purchases.
 */
export async function autoSinkExcessTokens(fastify, userId) {
  const userRes = await fastify.db.query('SELECT goal_tokens FROM users WHERE id = $1', [userId]);
  const currentGT = userRes.rows[0]?.goal_tokens || 0;

  if (currentGT > CARRYOVER_CAP) {
    const excess = currentGT - CARRYOVER_CAP;
    return await convertTokensToLegacyXP(fastify, userId, excess);
  }
  
  return { success: true, convertedAmount: 0 };
}

export default {
  convertTokensToLegacyXP,
  autoSinkExcessTokens,
  GT_XP_CONVERSION_RATE,
  XP_PER_ARENA_LEVEL,
  CARRYOVER_CAP
};
