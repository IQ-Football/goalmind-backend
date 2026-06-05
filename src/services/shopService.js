import { awardBadge, FOUNDING_PRO_ID, ARES_SURGE_ID } from './achievementService.js';

/**
 * Shop Service - Tribal Commerce
 */
export const shopService = {
  /**
   * Get the current shop catalog
   */
  async getCatalog(fastify) {
    const res = await fastify.db.query(
      'SELECT id, name, description, price_zar, price_gbp, price_eur, goal_tokens, category, metadata FROM shop_products WHERE is_active = true ORDER BY category, goal_tokens'
    );
    return res.rows;
  },

  /**
   * Process a product purchase
   * Ensures atomic updates to user balance and status
   */
  async purchaseProduct(fastify, { userId, productId, provider = 'mock', reference }) {
    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');

      // 1. Get product details and lock the product row (though not strictly necessary for reads)
      const productRes = await client.query(
        'SELECT * FROM shop_products WHERE id = $1 AND is_active = true',
        [productId]
      );
      
      if (productRes.rows.length === 0) {
        throw new Error('Product not found');
      }
      const product = productRes.rows[0];

      // 2. Lock the user row for atomic update
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

      // 3. Award GoalTokens if applicable
      let finalGoalTokensAwarded = 0;
      if (product.goal_tokens > 0) {
        // Check for Golden Lightning multiplier (Ares Surge badge)
        const hasAresSurgeRes = await client.query(
          'SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
          [userId, ARES_SURGE_ID]
        );
        
        finalGoalTokensAwarded = product.goal_tokens;
        if (hasAresSurgeRes.rows.length > 0) {
          finalGoalTokensAwarded = Math.round(finalGoalTokensAwarded * 1.2);
          fastify.log.info({ userId, productId }, 'Applying Golden Lightning multiplier to shop purchase');
        }

        await client.query(
          'UPDATE users SET goal_tokens = COALESCE(goal_tokens, 0) + $1 WHERE id = $2',
          [finalGoalTokensAwarded, userId]
        );
      }

      // 4. Handle Battle Pass / Pro status / Bundles
      let badgeAwarded = false;
      if (product.category === 'battle_pass' || product.id === 'vanguard_founders_pack') {
        await client.query(
          `UPDATE users SET 
             is_pro = true, 
             pro_expires_at = COALESCE(pro_expires_at, NOW()) + INTERVAL '30 days',
             metadata = metadata || jsonb_build_object('battle_pass_active', true, 'last_bp_purchase', NOW())
           WHERE id = $1`,
          [userId]
        );
        
        // Award Founding Pro badge
        try {
          badgeAwarded = await awardBadge(fastify, userId, FOUNDING_PRO_ID);
          
          // If it's the vanguard pack, also award the Vanguard Badge (id could be different, checking achievementService)
          if (product.id === 'vanguard_founders_pack') {
             // Assuming VANGUARD_BADGE_ID or similar. Let's check achievementService.js first.
          }
        } catch (badgeErr) {
          fastify.log.error({ badgeErr, userId }, 'Failed to award badge during shop purchase');
        }
      }

      // 5. Record transaction in gem_transactions
      const finalReference = reference || `SHOP_${Date.now()}_${userId.slice(0, 8)}`;
      await client.query(
        `INSERT INTO gem_transactions (user_id, amount, currency, provider, reference, type, created_at)
         VALUES ($1, $2, $3, $4, $5, 'shop_purchase', NOW())`,
        [userId, finalGoalTokensAwarded, 'GT', provider, finalReference]
      );

      await client.query('COMMIT');
      
      fastify.log.info({ userId, productId, reference: finalReference }, 'Shop purchase completed successfully');
      
      return { 
        success: true, 
        product: {
          id: product.id,
          name: product.name,
          goal_tokens: product.goal_tokens
        },
        badgeAwarded
      };
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error({ err, userId, productId }, 'Shop purchase failed');
      throw err;
    } finally {
      client.release();
    }
  }
};

export default shopService;
