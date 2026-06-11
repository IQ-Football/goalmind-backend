/**
 * GoalToken Service — The Arena's Economic Core
 * Handles token transactions, auditing via ledger, and balance tracking.
 */

export const TRANSACTION_TYPES = {
  BATTLE_WIN: 'battle_win',
  BATTLE_LOSS: 'battle_loss',
  BATTLE_DRAW: 'battle_draw',
  DAILY_3_LOOP: 'daily_3_loop',
  TOURNAMENT_ENTRY: 'tournament_entry',
  TOURNAMENT_WIN: 'tournament_win',
  PRESTIGE_PURCHASE: 'prestige_purchase',
  REFERRAL_BONUS: 'referral_bonus',
  ADMIN_ADJUSTMENT: 'admin_adjustment',
  INITIAL_GRANT: 'initial_grant',
  RANK_FREEZE: 'rank_freeze',
  BLITZ_BUFFER: 'blitz_buffer',
  RALLY_COMMAND: 'rally_command',
  SEASONAL_CARRYOVER: 'seasonal_carryover',
};

const VANGUARD_MULTIPLIER = 1.2;

/**
 * Credit GoalTokens to a user's account
 */
export async function creditTokens(fastify, { userId, amount, type, referenceId, metadata = {} }) {
  if (amount <= 0) throw new Error('Credit amount must be positive');

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Apply Vanguard multiplier if applicable
    let finalAmount = amount;
    const earnedTypes = [
      TRANSACTION_TYPES.BATTLE_WIN,
      TRANSACTION_TYPES.BATTLE_LOSS,
      TRANSACTION_TYPES.DAILY_3_LOOP,
      TRANSACTION_TYPES.TOURNAMENT_WIN,
      TRANSACTION_TYPES.REFERRAL_BONUS
    ];

    if (earnedTypes.includes(type)) {
      // 1.1 Check for active temporary multiplier first
      const boostRes = await client.query(
        'SELECT active_multiplier FROM users WHERE id = $1 AND multiplier_expires_at > NOW()',
        [userId]
      );
      
      const activeMultiplier = boostRes.rows[0]?.active_multiplier ? parseFloat(boostRes.rows[0].active_multiplier) : null;

      if (activeMultiplier && activeMultiplier > 1.0) {
        finalAmount = Math.floor(amount * activeMultiplier);
        metadata.active_multiplier_bonus = finalAmount - amount;
      } else {
        // 1.2 Fallback to cohort-based permanent multipliers
        // Optimize: Check Redis cache for cohort to avoid DB hit during surge
        let cohort = await fastify.redis.get(`user:${userId}:cohort`);
        
        if (!cohort) {
          const userRes = await client.query('SELECT cohort FROM users WHERE id = $1', [userId]);
          cohort = userRes.rows[0]?.cohort || 'none';
          // Cache for 1 hour
          await fastify.redis.set(`user:${userId}:cohort`, cohort, 'EX', 3600);
        }

        if (cohort === 'vanguard_500') {
          finalAmount = Math.floor(amount * VANGUARD_MULTIPLIER);
          metadata.vanguard_bonus = finalAmount - amount;
        } else if (cohort === 'founding_50k') {
          // Permanent +5% multiplier for the Genesis 50k cohort
          finalAmount = Math.floor(amount * 1.05);
          metadata.founding_50k_bonus = finalAmount - amount;
        }
      }
    }

    // 2. Record in ledger
    await client.query(
      `INSERT INTO goaltoken_ledger (user_id, amount, type, reference_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, finalAmount, type, referenceId, metadata]
    );

    // 3. Update user balance
    const result = await client.query(
      `UPDATE users SET goal_tokens = goal_tokens + $1 WHERE id = $2 RETURNING goal_tokens`,
      [finalAmount, userId]
    );

    await client.query('COMMIT');
    return { success: true, newBalance: result.rows[0].goal_tokens };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId, amount, type }, 'Failed to credit tokens');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Debit GoalTokens from a user's account
 */
export async function debitTokens(fastify, { userId, amount, type, referenceId, metadata = {} }) {
  if (amount <= 0) throw new Error('Debit amount must be positive');

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Check balance
    const userRes = await client.query('SELECT goal_tokens FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) throw new Error('User not found');
    
    const currentBalance = userRes.rows[0].goal_tokens;
    if (currentBalance < amount) {
      await client.query('ROLLBACK');
      return { success: false, error: 'INSUFFICIENT_FUNDS', balance: currentBalance };
    }

    // 2. Record in ledger (negative amount for debit)
    await client.query(
      `INSERT INTO goaltoken_ledger (user_id, amount, type, reference_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, -amount, type, referenceId, metadata]
    );

    // 3. Update user balance
    const result = await client.query(
      `UPDATE users SET goal_tokens = goal_tokens - $1 WHERE id = $2 RETURNING goal_tokens`,
      [amount, userId]
    );

    await client.query('COMMIT');
    return { success: true, newBalance: result.rows[0].goal_tokens };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId, amount, type }, 'Failed to debit tokens');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Purchase an item using GoalTokens
 */
export async function purchaseItem(fastify, { userId, itemType, referenceId, metadata = {} }) {
  const costs = {
    [TRANSACTION_TYPES.TOURNAMENT_ENTRY]: 100,
    [TRANSACTION_TYPES.RANK_FREEZE]: 500,
    [TRANSACTION_TYPES.BLITZ_BUFFER]: 200,
    [TRANSACTION_TYPES.RALLY_COMMAND]: 1000,
    [TRANSACTION_TYPES.PRESTIGE_PURCHASE]: 500, // Base cost
  };

  let amount = costs[itemType] || metadata.customAmount;
  if (!amount) throw new Error(`Unknown item type or missing custom amount: ${itemType}`);

  return debitTokens(fastify, {
    userId,
    amount,
    type: itemType,
    referenceId,
    metadata
  });
}

/**
 * Perform seasonal carryover for a user
 */
export async function performSeasonalCarryover(fastify, userId) {
  const CARRYOVER_RATE = 0.5;
  const CARRYOVER_CAP = 5000;

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Get current balance
    const userRes = await client.query('SELECT goal_tokens, legacy_xp FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) throw new Error('User not found');
    
    const currentBalance = userRes.rows[0].goal_tokens;
    if (currentBalance <= 0) {
      await client.query('ROLLBACK');
      return { success: true, carryover: 0, legacyXP: 0 };
    }

    // 2. Calculate carryover and legacy XP
    let carryoverAmount = Math.floor(currentBalance * CARRYOVER_RATE);
    let legacyXPAmount = 0;

    if (carryoverAmount > CARRYOVER_CAP) {
      legacyXPAmount = carryoverAmount - CARRYOVER_CAP;
      carryoverAmount = CARRYOVER_CAP;
    }

    const reductionAmount = currentBalance - carryoverAmount;

    // 3. Record in ledger
    await client.query(
      `INSERT INTO goaltoken_ledger (user_id, amount, type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [userId, -reductionAmount, TRANSACTION_TYPES.SEASONAL_CARRYOVER, { 
        original_balance: currentBalance, 
        carryover: carryoverAmount, 
        legacy_xp_gained: legacyXPAmount 
      }]
    );

    // 4. Update user balance and legacy XP
    await client.query(
      `UPDATE users SET goal_tokens = $1, legacy_xp = legacy_xp + $2 WHERE id = $3`,
      [carryoverAmount, legacyXPAmount, userId]
    );

    await client.query('COMMIT');
    return { success: true, carryover: carryoverAmount, legacyXP: legacyXPAmount };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Failed seasonal carryover');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get user's current token balance
 */
export async function getTokenBalance(fastify, userId) {
  const result = await fastify.db.query('SELECT goal_tokens, legacy_xp FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) return { goal_tokens: 0, legacy_xp: 0 };
  return result.rows[0];
}

/**
 * Get user's token transaction history
 */
export async function getTokenHistory(fastify, userId, limit = 50, offset = 0) {
  const result = await fastify.db.query(
    `SELECT id, amount, type, reference_id, metadata, created_at
     FROM goaltoken_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}
