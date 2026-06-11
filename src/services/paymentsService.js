/**
 * Multi-Currency Payment Service
 * Handles ZAR via Paystack, GBP/EUR via Stripe
 * 
 * Provider Selection:
 * - ZAR → Paystack
 * - GBP / EUR → Stripe
 */

import crypto from 'crypto';
import { createCheckoutSession, retrieveCheckoutSession, handleStripePaymentSuccess, createCustomerPortalSession, refundStripePayment as stripeRefund, verifyStripeWebhookSignature as stripeVerify, EUROPE_PRICING } from './stripeService.js';
import { awardBadge, FOUNDING_PRO_ID, EKO_VANGUARD_ID } from './achievementService.js';
import { initializeMockPayment } from './mockPaymentsService.js';
import { REGIONAL_CONFIG, GOAL_TOKEN_PACKS } from '../config/pricing.js';

// ─── ZAR / Paystack ──────────────────────────────────────────────────────────

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_placeholder';
const PAYSTACK_API_URL = 'https://api.paystack.co';
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || 'whsec_placeholder';

/**
 * Verify Paystack webhook signature
 */
export function verifyPaystackWebhookSignature(payload, signature) {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return hash === signature;
}

/**
 * Initialize a Paystack payment (Generic for NGN, GHS, ZAR, KES)
 */
export async function initializePaystackPayment(fastify, { userId, amount, currency, email, plan, callbackUrl }) {
  const amountInSmallestUnit = Math.round(amount * 100);
  const reference = `GM_${Date.now()}_${userId.slice(0, 8)}`;

  try {
    const response = await fetch(`${PAYSTACK_API_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInSmallestUnit,
        currency: currency.toUpperCase(),
        email,
        reference,
        callback_url: callbackUrl || `${process.env.APP_URL || 'http://localhost:8080'}/payments/callback`,
        metadata: { userId, plan, platform: 'goalmind' },
        channels: ['card', 'eft', 'mobile_money', 'ussd'],
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      fastify.log.error({ data }, 'Paystack initialize failed');
      return { success: false, error: data.message || 'Payment initialization failed' };
    }

    await fastify.db.query(
      `INSERT INTO payments (reference, user_id, amount, currency, status, plan, provider, metadata)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'paystack', $6)
       ON CONFLICT (reference) DO NOTHING`,
      [reference, userId, amount, currency, plan, JSON.stringify({ provider_ref: data.data.reference })]
    );

    return {
      success: true,
      data: {
        authorizationUrl: data.data.authorization_url,
        reference: data.data.reference,
        amount,
        currency,
      },
    };
  } catch (err) {
    fastify.log.error({ err }, 'Paystack initialize error');
    return { success: false, error: 'Payment service unavailable' };
  }
}

/**
 * Initialize a Paystack payment for ZAR (Deprecated - use initializePaystackPayment)
 */
export async function initializePayment(fastify, { userId, amountInZAR, email, plan = 'tier_pro', callbackUrl }) {
  return initializePaystackPayment(fastify, { userId, amount: amountInZAR, currency: 'ZAR', email, plan, callbackUrl });
}

/**
 * Verify a Paystack transaction by reference
 */
export async function verifyTransaction(fastify, reference) {
  try {
    const response = await fetch(`${PAYSTACK_API_URL}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return { success: false, error: data.message || 'Verification failed' };
    }

    const tx = data.data;

    return {
      success: true,
      data: {
        reference: tx.reference,
        amount: tx.amount / 100,
        currency: tx.currency,
        status: tx.status,
        customerEmail: tx.customer.email,
        paidAt: tx.paidAt,
        metadata: tx.metadata,
      },
    };
  } catch (err) {
    fastify.log.error({ err }, 'Paystack verify error');
    return { success: false, error: 'Verification service unavailable' };
  }
}

/**
 * Handle successful payment - upgrade user to Pro
 */
export async function handleSuccessfulPayment(fastify, reference, userId, plan, provider = 'paystack', currency = 'ZAR') {
  const client = await fastify.db.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE payments SET status = 'completed', completed_at = NOW() WHERE reference = $1`,
      [reference]
    );

    const planConfig = {
      tier_pro: { gems: 500, duration_days: 30 },
      tier_pro_annual: { gems: 500, duration_days: 365 },
      tier_pro_monthly: { gems: 200, duration_days: 30 }, // Added
      tribe_gems_10: { gems: 10, one_time: true },
      tribe_gems_50: { gems: 50, one_time: true },
      tribe_gems_100: { gems: 100, one_time: true },
      tribe_gems_500: { gems: 500, one_time: true }, // Added
      tribe_gems_1200: { gems: 1200, one_time: true }, // Added
      // GoalToken packs
      goal_tokens_impulse: { goal_tokens: 50, one_time: true },
      goal_tokens_warrior: { goal_tokens: 250, one_time: true },
      goal_tokens_tribe_leader: { goal_tokens: 1000, one_time: true },
      // Prestige Monetization
      tournament_entry: { one_time: true, type: 'tournament_entry' },
      badge_unlock: { one_time: true, type: 'badge_unlock' },
      lagos_pro_starter: { goal_tokens: 500, one_time: true, type: 'lagos_pro_starter' }
    };

    const config = planConfig[plan] || { gems: 0, goal_tokens: 0, one_time: true };

    await client.query(
      `UPDATE users SET
         gems = COALESCE(gems, 0) + $1,
         goal_tokens = COALESCE(goal_tokens, 0) + $2,
         is_pro = CASE WHEN $3 LIKE 'tier_pro%' THEN true ELSE is_pro END,
         pro_expires_at = CASE WHEN $3 = 'tier_pro' OR $3 = 'tier_pro_monthly' THEN NOW() + INTERVAL '1 day' * $4
                               WHEN $3 = 'tier_pro_annual' THEN NOW() + INTERVAL '1 day' * $4
                               ELSE pro_expires_at END,
         last_active_at = NOW()
       WHERE id = $5`,
      [config.gems || 0, config.goal_tokens || 0, plan, config.duration_days || 30, userId]
    );

    // Specific logic for tournament entry or badge unlock
    if (config.type === 'tournament_entry') {
        // Log tournament entry intent - would typically join a table
        await client.query(
            'INSERT INTO system_events (event_type, user_id, metadata) VALUES ($1, $2, $3)',
            ['TOURNAMENT_ENTRY_PAID', userId, JSON.stringify({ reference, plan })]
        );
    } else if (config.type === 'badge_unlock') {
        // Logic to award a generic prestige badge or handle via metadata
        const badgeId = '770e8400-e29b-41d4-a716-446655440005'; // Example: Paid Prestige Badge
        await awardBadge(fastify, userId, badgeId);
    } else if (config.type === 'lagos_pro_starter') {
        // Lagos Pro Starter Logic
        await awardBadge(fastify, userId, EKO_VANGUARD_ID);
        
        // 1.2x Multiplier for 24h
        await client.query(
          `UPDATE users SET 
             active_multiplier = 1.20,
             multiplier_expires_at = NOW() + INTERVAL '24 hours'
           WHERE id = $1`,
          [userId]
        );
    }

    if (config.gems > 0) {
      await client.query(
        `INSERT INTO gem_transactions (user_id, amount, currency, provider, reference, type, created_at)
         VALUES ($1, $2, $3, $4, $5, 'purchase', NOW())`,
        [userId, config.gems, currency, provider, reference]
      );
    }

    if (config.goal_tokens > 0) {
      await client.query(
        `INSERT INTO gem_transactions (user_id, amount, currency, provider, reference, type, created_at)
         VALUES ($1, $2, 'GOALTOKEN', $3, $4, 'purchase', NOW())`,
        [userId, config.goal_tokens, provider, reference]
      );
    }

    // Referral Commission Logic (The Recruiter's War-Chest)
    try {
      const referralResult = await client.query(
        `SELECT r.referrer_id, r.created_at as referral_created_at,
                t.slug as tribe_slug,
                EXISTS(SELECT 1 FROM user_achievements ua
                       WHERE ua.user_id = r.referrer_id
                       AND ua.achievement_id = '550e8400-e29b-41d4-a716-446655440000') as is_founding_general,
                EXISTS(SELECT 1 FROM user_achievements ua
                       WHERE ua.user_id = r.referrer_id
                       AND ua.achievement_id = '550e8400-e29b-41d4-a716-446655440003') as is_tribe_commander
         FROM referrals r
         JOIN users u ON r.referrer_id = u.id
         LEFT JOIN tribes t ON u.tribe_id = t.id
         WHERE r.recruit_id = $1 AND r.status = 'joined'
         LIMIT 1`,
        [userId]
      );

      if (referralResult.rows.length > 0) {
        const referral = referralResult.rows[0];
        const laggardSlugs = ['kaizer-chiefs', 'orlando-pirates', 'simba-sc', 'yanga-sc', 'raja-casablanca', 'al-ahly', 'zamalek'];

        // 30 day window for the recruit's earnings to qualify for commission (Standard)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const isWithin30Days = new Date(referral.referral_created_at) > thirtyDaysAgo;

        const isLaggardGeneral = referral.is_founding_general &&
                                 laggardSlugs.includes(referral.tribe_slug) &&
                                 isWithin30Days;

        let commissionRate = 0;
        if (isLaggardGeneral) {
          commissionRate = 0.35; // Premium bonus for laggard FGs
        } else if (referral.is_tribe_commander) {
          commissionRate = 0.15; // Official TC commission
        } else if (isWithin30Days) {
          commissionRate = 0.10; // Standard low-tier commission for early recruits
        }

        const commissionGems = Math.floor(config.gems * commissionRate);

        if (commissionGems > 0) {
          await client.query(
            `UPDATE users SET gems = COALESCE(gems, 0) + $1 WHERE id = $2`,
            [commissionGems, referral.referrer_id]
          );
          await client.query(
            `INSERT INTO gem_transactions (user_id, amount, currency, provider, reference, type, created_at)
             VALUES ($1, $2, 'GEM', 'commission', $3, 'referral_commission', NOW())`,
            [referral.referrer_id, commissionGems, reference]
          );
          fastify.log.info({ 
            referrerId: referral.referrer_id, 
            recruitId: userId, 
            commissionGems, 
            rate: commissionRate,
            isLaggardGeneral 
          }, 'Referral commission awarded');
        }
      }
    } catch (refErr) {
      fastify.log.error({ err: refErr, userId }, 'Failed to award referral commission');
      // Don't fail the whole transaction if commission fails
    }

    await client.query('COMMIT');

    fastify.log.info({ userId, plan, reference, provider }, 'Payment successful - gems awarded');

    // Award 'Founding Pro' badge if it's a pro plan
    if (plan.startsWith('tier_pro')) {
      try {
        await awardBadge(fastify, userId, FOUNDING_PRO_ID);
      } catch (badgeErr) {
        fastify.log.error({ err: badgeErr, userId }, 'Failed to award Founding Pro badge');
      }
    }

    return { success: true, gemsAwarded: config.gems, plan };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, reference }, 'Failed to process ZAR payment');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refund a Paystack transaction
 */
export async function refundTransaction(fastify, reference, amountInZAR) {
  const amountInKobo = Math.round(amountInZAR * 100);

  try {
    const response = await fetch(`${PAYSTACK_API_URL}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transaction: reference, amount: amountInKobo, currency: 'ZAR' }),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return { success: false, error: data.message || 'Refund failed' };
    }

    await fastify.db.query(
      `UPDATE payments SET status = 'refunded', refunded_at = NOW() WHERE reference = $1`,
      [reference]
    );

    return { success: true, refund: data.data };
  } catch (err) {
    fastify.log.error({ err }, 'Paystack refund error');
    return { success: false, error: 'Refund service unavailable' };
  }
}

// ─── Currency Helpers ────────────────────────────────────────────────────────

export const ZAR = {
  format(amountInZAR) {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(amountInZAR);
  },
  toKobo(amountInZAR) {
    return Math.round(amountInZAR * 100);
  },
  PRO_PRICE_ZAR: 39.99,
  PRO_PRICE_ZAR_ANNUAL: 399.99,
  GEM_PACKS: {
    small: { gems: 10, priceZAR: 19.99, label: 'R19.99' },
    medium: { gems: 50, priceZAR: 89.99, label: 'R89.99' },
    large: { gems: 100, priceZAR: 159.99, label: 'R159.99' },
  },
};

export { EUROPE_PRICING, REGIONAL_CONFIG, GOAL_TOKEN_PACKS };

// ─── Unified initialize for all currencies ─────────────────────────────────

export async function initializePaymentByCurrency(fastify, { userId, planId, currency, email, callbackUrl }) {
  const upperCurrency = currency.toUpperCase();
  const regional = REGIONAL_CONFIG[upperCurrency];

  if (upperCurrency === 'MOCK') {
    return initializeMockPayment(fastify, { userId, amount: getAmountForPlan(planId, 'ZAR'), email, plan: planId, callbackUrl });
  }

  if (regional) {
    const amount = getAmountForPlan(planId, upperCurrency);
    if (regional.provider === 'paystack') {
      return initializePaystackPayment(fastify, { userId, amount, currency: upperCurrency, email, plan: planId, callbackUrl });
    } else {
      // Use Stripe for other regional currencies
      return createCheckoutSession(fastify, {
        userId,
        planId,
        currency: upperCurrency,
        email,
        callbackUrl,
      });
    }
  }

  if (upperCurrency === 'GBP' || upperCurrency === 'EUR') {
    return createCheckoutSession(fastify, {
      userId,
      planId,
      currency: upperCurrency,
      email,
      callbackUrl,
    });
  }

  return { success: false, error: 'Unsupported currency' };
}

function getAmountForPlan(planId, currency) {
  const upperCurrency = currency.toUpperCase();
  const regional = REGIONAL_CONFIG[upperCurrency];

  if (planId === 'tier_pro_monthly') return regional?.pro?.monthly?.price || 39.99;
  if (planId === 'tier_pro_annual') return regional?.pro?.annual?.price || 399.99;
  
  // GoalToken packs
  if (planId.startsWith('goal_tokens_')) {
    const packId = planId.replace('goal_tokens_', '');
    return regional?.packs?.[packId]?.price || GOAL_TOKEN_PACKS[packId]?.priceUSD || 0;
  }

  // Prestige items
  if (planId === 'tournament_entry') return regional?.prestige?.tournament_entry?.price || 5.00;
  if (planId === 'badge_unlock') return regional?.prestige?.badge_unlock?.price || 25.00;
  if (planId === 'lagos_pro_starter') return regional?.prestige?.lagos_pro_starter?.price || 5.00;

  // Gem packs (Legacy ZAR logic)
  if (upperCurrency === 'ZAR') {
    const gemPack = Object.values(ZAR.GEM_PACKS).find(p => planId.includes(String(p.gems)));
    if (gemPack) return gemPack.priceZAR;
  }
  
  return 0;
}

export default {
  verifyPaystackWebhookSignature,
  initializePayment,
  initializePaystackPayment,
  verifyTransaction,
  handleSuccessfulPayment,
  refundTransaction,
  initializePaymentByCurrency,
  ZAR,
  EUROPE_PRICING,
  REGIONAL_CONFIG,
  GOAL_TOKEN_PACKS,
};