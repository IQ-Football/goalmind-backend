/**
 * Stripe Payment Service
 * Handles GBP (£) and EUR (€) transactions via Stripe (Card, Apple Pay, Google Pay)
 *
 * Supported currencies: GBP, EUR
 * Supported payment methods: Card, Apple Pay, Google Pay
 */

import Stripe from 'stripe';
import { awardBadge, FOUNDING_PRO_ID } from './achievementService.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10',
});

// ─── Currency Configuration ──────────────────────────────────────────────────

export const EUROPE_PRICING = {
  GBP: {
    symbol: '£',
    locale: 'en-GB',
    currency: 'GBP',
    pro: {
      monthly: { amount: 399, label: '£3.99', interval: 'month' },
      annual: { amount: 3499, label: '£34.99', interval: 'year' },
    },
    tribeTransfer: { amount: 199, label: '£1.99' },
    gemPacks: {
      '100': { amount: 79, label: '£0.79', gems: 100 },
      '500': { amount: 349, label: '£3.49', gems: 500 },
      '1200': { amount: 799, label: '£7.99', gems: 1200 },
    },
  },
  EUR: {
    symbol: '€',
    locale: 'de-DE',
    currency: 'EUR',
    pro: {
      monthly: { amount: 499, label: '€4.99', interval: 'month' },
      annual: { amount: 4499, label: '€44.99', interval: 'year' },
    },
    tribeTransfer: { amount: 249, label: '€2.49' },
    gemPacks: {
      '100': { amount: 89, label: '€0.89', gems: 100 },
      '500': { amount: 449, label: '€4.49', gems: 500 },
      '1200': { amount: 899, label: '€8.99', gems: 1200 },
    },
  },
};

export const PLAN_TO_STRIPE_PRICE_ID = {
  // GBP
  'tier_pro_monthly_gbp': process.env.STRIPE_GBP_PRO_MONTHLY_PRICE_ID || null,
  'tier_pro_annual_gbp': process.env.STRIPE_GBP_PRO_ANNUAL_PRICE_ID || null,
  'tribe_gems_100_gbp': process.env.STRIPE_GBP_GEMS_100_PRICE_ID || null,
  'tribe_gems_500_gbp': process.env.STRIPE_GBP_GEMS_500_PRICE_ID || null,
  'tribe_gems_1200_gbp': process.env.STRIPE_GBP_GEMS_1200_PRICE_ID || null,
  'tribe_transfer_gbp': process.env.STRIPE_GBP_TRANSFER_PRICE_ID || null,
  // EUR
  'tier_pro_monthly_eur': process.env.STRIPE_EUR_PRO_MONTHLY_PRICE_ID || null,
  'tier_pro_annual_eur': process.env.STRIPE_EUR_PRO_ANNUAL_PRICE_ID || null,
  'tribe_gems_100_eur': process.env.STRIPE_EUR_GEMS_100_PRICE_ID || null,
  'tribe_gems_500_eur': process.env.STRIPE_EUR_GEMS_500_PRICE_ID || null,
  'tribe_gems_1200_eur': process.env.STRIPE_EUR_GEMS_1200_PRICE_ID || null,
  'tribe_transfer_eur': process.env.STRIPE_EUR_TRANSFER_PRICE_ID || null,
};

// ─── Webhook Signature Verification ──────────────────────────────────────────

export function verifyStripeWebhookSignature(payload, signature) {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
    return { success: true, event };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Create Checkout Session ─────────────────────────────────────────────────

export async function createCheckoutSession(fastify, {
  userId,
  planId,
  currency = 'GBP',
  email,
  callbackUrl,
}) {
  const reference = `GM_${Date.now()}_${userId.slice(0, 8)}`;

  try {
    // Determine price ID or amount based on plan
    const priceConfig = getPriceConfig(planId, currency);
    if (!priceConfig) {
      return { success: false, error: 'Invalid plan or currency' };
    }

    const sessionParams = {
      mode: priceConfig.recurring ? 'subscription' : 'payment',
      customer_email: email,
      success_url: `${callbackUrl || process.env.APP_URL || 'http://localhost:8080'}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${callbackUrl || process.env.APP_URL || 'http://localhost:8080'}/payments/cancel`,
      metadata: {
        userId,
        plan: planId,
        currency,
        platform: 'goalmind',
      },
      reference,
    };

    if (priceConfig.priceId) {
      // Use pre-configured Stripe Price ID
      sessionParams.line_items = [{ price: priceConfig.priceId, quantity: 1 }];
    } else {
      // Use ad-hoc amount
      sessionParams.line_items = [{
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: priceConfig.productName,
            description: priceConfig.description,
          },
          unit_amount: priceConfig.amount,
          ...(priceConfig.recurring ? { recurring: { interval: priceConfig.interval } } : {}),
        },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Store pending payment in database
    const currencyCode = currency === 'GBP' ? 'GBP' : 'EUR';
    await fastify.db.query(
      `INSERT INTO payments (reference, user_id, amount, currency, status, plan, provider, metadata)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'stripe', $6)
       ON CONFLICT (reference) DO NOTHING`,
      [reference, userId, priceConfig.amount / 100, currencyCode, planId, JSON.stringify({
        sessionId: session.id,
        provider_ref: session.id,
      })]
    );

    return {
      success: true,
      data: {
        sessionId: session.id,
        url: session.url,
        reference,
        amount: priceConfig.amount / 100,
        currency,
      },
    };
  } catch (err) {
    fastify.log.error({ err }, 'Stripe checkout session error');
    return { success: false, error: err.message };
  }
}

// ─── Retrieve Checkout Session ─────────────────────────────────────────────────

export async function retrieveCheckoutSession(fastify, sessionId) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return { success: true, data: session };
  } catch (err) {
    fastify.log.error({ err }, 'Stripe retrieve session error');
    return { success: false, error: err.message };
  }
}

// ─── Handle Successful Payment ─────────────────────────────────────────────────

export async function handleStripePaymentSuccess(fastify, sessionId) {
  const client = await fastify.db.connect();

  try {
    // Retrieve the session to get payment details
    const sessionResult = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'line_items'],
    });

    if (sessionResult.payment_status !== 'paid') {
      return { success: false, error: 'Payment not completed' };
    }

    const { userId, plan, currency } = sessionResult.metadata || {};
    const reference = sessionResult.metadata?.reference || sessionResult.id;
    const amount = sessionResult.amount_total / 100;

    await client.query('BEGIN');

    // Update payment record
    await client.query(
      `UPDATE payments SET status = 'completed', completed_at = NOW(),
       metadata = jsonb_set(metadata, '{stripe_session_id}', $1)
       WHERE reference = $2`,
      [JSON.stringify(sessionId), reference]
    );

    // Determine gems to award based on plan
    const gemsAwarded = getGemsForPlan(plan);

    // Update user gems and pro status
    const isProPlan = plan.includes('pro');
    const proDurationDays = plan.includes('annual') ? 365 : 30;

    await client.query(
      `UPDATE users SET
         gems = COALESCE(gems, 0) + $1,
         is_pro = CASE WHEN $2 THEN true ELSE is_pro END,
         pro_expires_at = CASE WHEN $2 THEN GREATEST(COALESCE(pro_expires_at, NOW()), NOW()) + INTERVAL '1 day' * $3 ELSE pro_expires_at END,
         last_active_at = NOW()
       WHERE id = $4`,
      [gemsAwarded, isProPlan, proDurationDays, userId]
    );

    // Record gem transaction
    const currencyCode = currency === 'GBP' ? 'GBP' : 'EUR';
    await client.query(
      `INSERT INTO gem_transactions (user_id, amount, currency, provider, reference, type, created_at)
       VALUES ($1, $2, $3, 'stripe', $4, 'purchase', NOW())`,
      [userId, gemsAwarded, currencyCode, reference]
    );

    await client.query('COMMIT');

    fastify.log.info({ userId, plan, reference, gemsAwarded }, 'Stripe payment successful');

    // Award 'Founding Pro' badge if it's a pro plan
    if (isProPlan) {
      try {
        await awardBadge(fastify, userId, FOUNDING_PRO_ID);
      } catch (badgeErr) {
        fastify.log.error({ err: badgeErr, userId }, 'Failed to award Founding Pro badge');
      }
    }

    return { success: true, gemsAwarded, plan, isPro: isProPlan };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, sessionId }, 'Failed to process Stripe payment');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Create Customer Portal Session ───────────────────────────────────────────

export async function createCustomerPortalSession(fastify, { userId, email, returnUrl }) {
  try {
    // Create or retrieve Stripe customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return { success: true, data: { url: session.url } };
  } catch (err) {
    fastify.log.error({ err }, 'Stripe customer portal error');
    return { success: false, error: err.message };
  }
}

// ─── Issue Refund ─────────────────────────────────────────────────────────────

export async function refundStripePayment(fastify, paymentIntentId, amount = null) {
  try {
    const refundParams = { payment_intent: paymentIntentId };
    if (amount) {
      refundParams.amount = Math.round(amount * 100); // Convert to cents
    }

    const refund = await stripe.refunds.create(refundParams);

    return { success: true, data: refund };
  } catch (err) {
    fastify.log.error({ err }, 'Stripe refund error');
    return { success: false, error: err.message };
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function getPriceConfig(planId, currency) {
  const upperCurrency = currency.toUpperCase();
  const pricing = EUROPE_PRICING[upperCurrency];

  if (!pricing) return null;

  // Pro monthly
  if (planId === `tier_pro_monthly_${lowerCurrency(currency)}`) {
    return {
      amount: pricing.pro.monthly.amount,
      productName: 'GoalMind Pro Monthly',
      description: 'Unlimited Battles, Advanced Stats, Exclusive Badges',
      recurring: true,
      interval: 'month',
      priceId: PLAN_TO_STRIPE_PRICE_ID[`tier_pro_monthly_${lowerCurrency(currency)}`],
    };
  }

  // Pro annual
  if (planId === `tier_pro_annual_${lowerCurrency(currency)}`) {
    return {
      amount: pricing.pro.annual.amount,
      productName: 'GoalMind Pro Annual',
      description: 'Unlimited Battles, Advanced Stats, Exclusive Badges - Save 17%',
      recurring: true,
      interval: 'year',
      priceId: PLAN_TO_STRIPE_PRICE_ID[`tier_pro_annual_${lowerCurrency(currency)}`],
    };
  }

  // Gem packs
  const gemPackMatch = planId.match(/^tribe_gems_(\d+)_/);
  if (gemPackMatch) {
    const gems = gemPackMatch[1];
    const pack = pricing.gemPacks[gems];
    if (pack) {
      return {
        amount: pack.amount,
        productName: `${gems} Tribe Gems`,
        description: `${gems} Tribe Gems for cosmetics and upgrades`,
        recurring: false,
        priceId: PLAN_TO_STRIPE_PRICE_ID[`tribe_gems_${gems}_${lowerCurrency(currency)}`],
      };
    }
  }

  // Tribe transfer
  if (planId === `tribe_transfer_${lowerCurrency(currency)}`) {
    return {
      amount: pricing.tribeTransfer.amount,
      productName: 'Tribe Transfer',
      description: 'Change your tribe affiliation',
      recurring: false,
      priceId: PLAN_TO_STRIPE_PRICE_ID[`tribe_transfer_${lowerCurrency(currency)}`],
    };
  }

  return null;
}

function getGemsForPlan(plan) {
  // Extract gems from plan name
  const gemMatch = plan.match(/tribe_gems_(\d+)/);
  if (gemMatch) {
    return parseInt(gemMatch[1]);
  }

  // Pro plans get 500 gems on annual, 200 on monthly
  if (plan.includes('pro_annual')) return 500;
  if (plan.includes('pro_monthly')) return 200;

  return 0;
}

function lowerCurrency(currency) {
  return currency.toLowerCase();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const GBP = EUROPE_PRICING.GBP;
export const EUR = EUROPE_PRICING.EUR;

export default {
  verifyStripeWebhookSignature,
  createCheckoutSession,
  retrieveCheckoutSession,
  handleStripePaymentSuccess,
  createCustomerPortalSession,
  refundStripePayment,
  EUROPE_PRICING,
  PLAN_TO_STRIPE_PRICE_ID,
  GBP,
  EUR,
};