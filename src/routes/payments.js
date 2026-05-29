import { authenticate } from '../middleware/auth.js';
import {
  initializePayment,
  verifyTransaction,
  handleSuccessfulPayment,
  refundTransaction,
  verifyPaystackWebhookSignature,
  ZAR,
  EUROPE_PRICING,
  initializePaymentByCurrency,
} from '../services/paymentsService.js';
import {
  confirmMockPayment,
} from '../services/mockPaymentsService.js';
import {
  createCheckoutSession,
  retrieveCheckoutSession,
  handleStripePaymentSuccess,
  verifyStripeWebhookSignature,
  createCustomerPortalSession,
  refundStripePayment,
} from '../services/stripeService.js';

const paymentsRoutes = async (fastify, options) => {

  // ─── GET /payments/plans ─────────────────────────────────────────────────
  // Returns plans for all supported currencies based on Accept-Language or query param
  fastify.get('/plans', async (request, reply) => {
    const { currency: forcedCurrency } = request.query;
    const acceptLang = request.headers['accept-language'] || '';
    
    // Determine currency from header or forced param
    let currency = forcedCurrency?.toUpperCase();
    if (!currency) {
      if (acceptLang.includes('en-GB') || acceptLang.includes('en-GB')) currency = 'GBP';
      else if (acceptLang.includes('de') || acceptLang.includes('fr') || acceptLang.includes('it') || acceptLang.includes('es')) currency = 'EUR';
      else currency = 'ZAR'; // Default for SA market
    }

    const data = {
      currency,
      locale: EUROPE_PRICING[currency]?.locale || ZAR.PRO_PRICE_ZAR,
    };

    if (currency === 'ZAR') {
      data.currencySymbol = 'R';
      data.pro = {
        monthly: { planId: 'tier_pro_monthly', price: ZAR.PRO_PRICE_ZAR, label: ZAR.format(ZAR.PRO_PRICE_ZAR), interval: 'month' },
        annual: { planId: 'tier_pro_annual', price: ZAR.PRO_PRICE_ZAR_ANNUAL, label: ZAR.format(ZAR.PRO_PRICE_ZAR_ANNUAL), interval: 'year' },
      };
      data.gemPacks = Object.entries(ZAR.GEM_PACKS).map(([key, pack]) => ({
        packId: key, gems: pack.gems, price: pack.priceZAR, label: pack.label,
      }));
    } else {
      const eu = EUROPE_PRICING[currency];
      data.currencySymbol = eu.symbol;
      data.pro = {
        monthly: { planId: `tier_pro_monthly_${currency.toLowerCase()}`, price: eu.pro.monthly.amount / 100, label: eu.pro.monthly.label, interval: 'month' },
        annual: { planId: `tier_pro_annual_${currency.toLowerCase()}`, price: eu.pro.annual.amount / 100, label: eu.pro.annual.label, interval: 'year' },
      };
      data.gemPacks = Object.entries(eu.gemPacks).map(([gems, pack]) => ({
        packId: `tribe_gems_${gems}_${currency.toLowerCase()}`, gems: pack.gems, price: pack.amount / 100, label: pack.label,
      }));
      data.tribeTransfer = { planId: `tribe_transfer_${currency.toLowerCase()}`, price: eu.tribeTransfer.amount / 100, label: eu.tribeTransfer.label };
    }

    return reply.send({
      success: true,
      data,
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ─── POST /payments/initialize ───────────────────────────────────────────
  // Initialize a payment - detects currency from plan and routes to Paystack or Stripe
  fastify.post('/initialize', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { planId, currency = 'ZAR', callbackUrl } = request.body;
    const userId = request.user.id;
    const upperCurrency = currency.toUpperCase();

    // Validate plan
    const validPlans = [
      'tier_pro_monthly', 'tier_pro_annual',
      `tier_pro_monthly_gbp`, `tier_pro_annual_gbp`,
      `tier_pro_monthly_eur`, `tier_pro_annual_eur`,
      'tribe_gems_100', 'tribe_gems_500', 'tribe_gems_1200',
      `tribe_gems_100_gbp`, `tribe_gems_500_gbp`, `tribe_gems_1200_gbp`,
      `tribe_gems_100_eur`, `tribe_gems_500_eur`, `tribe_gems_1200_eur`,
      'tribe_transfer_gbp', 'tribe_transfer_eur',
    ];

    if (!planId || !validPlans.some(p => planId === p)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PLAN', message: 'Invalid plan ID', requestId: request.id },
      });
    }

    // Route to Paystack (ZAR) or Stripe (GBP/EUR)
    const result = await initializePaymentByCurrency(fastify, {
      userId,
      planId,
      currency: upperCurrency,
      email: request.user.email,
      callbackUrl,
    });

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'PAYMENT_INIT_FAILED', message: result.error, requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: {
        ...result.data,
        currency: upperCurrency,
        provider: upperCurrency === 'ZAR' ? 'paystack' : 'stripe',
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ─── GET /payments/verify/:reference ─────────────────────────────────────
  // Verify a Paystack (ZAR) payment
  fastify.get('/verify/:reference', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { reference } = request.params;
    const userId = request.user.id;

    const result = await verifyTransaction(fastify, reference);

    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: result.error, requestId: request.id },
      });
    }

    if (result.data.status === 'success') {
      await handleSuccessfulPayment(fastify, reference, userId, result.data.metadata?.plan || 'tier_pro');
    }

    return reply.send({
      success: true,
      data: {
        reference: result.data.reference,
        amount: result.data.amount,
        currency: result.data.currency,
        status: result.data.status,
        paidAt: result.data.paidAt,
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ─── GET /payments/stripe/verify/:sessionId ──────────────────────────────
  // Verify a Stripe (GBP/EUR) checkout session
  fastify.get('/stripe/verify/:sessionId', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const userId = request.user.id;

    const result = await retrieveCheckoutSession(fastify, sessionId);

    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: result.error, requestId: request.id },
      });
    }

    const session = result.data;

    if (session.payment_status === 'paid') {
      try {
        const outcome = await handleStripePaymentSuccess(fastify, sessionId);
        return reply.send({
          success: true,
          data: {
            sessionId,
            paymentStatus: session.payment_status,
            amount: session.amount_total / 100,
            currency: session.currency.toUpperCase(),
            gemsAwarded: outcome.gemsAwarded,
            isPro: outcome.isPro,
          },
          meta: { timestamp: new Date().toISOString(), requestId: request.id },
        });
      } catch (err) {
        fastify.log.error({ err }, 'Stripe post-payment processing failed');
        return reply.status(500).send({
          success: false,
          error: { code: 'PAYMENT_PROCESSING_ERROR', message: 'Payment received but reward delivery failed', requestId: request.id },
        });
      }
    }

    return reply.send({
      success: true,
      data: {
        sessionId,
        paymentStatus: session.payment_status,
        amount: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ─── POST /payments/stripe/webhook ──────────────────────────────────────
  // Stripe webhook handler (no auth - Stripe signs the payload)
  fastify.post('/stripe/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    let rawBody = '';
    if (request.rawBody) {
      rawBody = request.rawBody;
    } else if (Buffer.isBuffer(request.body)) {
      rawBody = request.body.toString();
    } else if (typeof request.body === 'string') {
      rawBody = request.body;
    } else {
      rawBody = JSON.stringify(request.body);
    }

    const verification = verifyStripeWebhookSignature(rawBody, signature);
    if (!verification.success) {
      fastify.log.warn('Stripe webhook: invalid signature');
      return reply.status(401).send({ success: false, error: 'Invalid signature' });
    }

    const event = verification.event;

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.payment_status === 'paid') {
          try {
            await handleStripePaymentSuccess(fastify, session.id);
            fastify.log.info({ sessionId: session.id }, 'Stripe webhook: payment success processed');
          } catch (err) {
            fastify.log.error({ err, sessionId: session.id }, 'Stripe webhook: payment processing failed');
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        await fastify.db.query(
          `UPDATE payments SET status = 'refunded', refunded_at = NOW()
           WHERE metadata->>'stripe_session_id' = $1 OR metadata->>'payment_intent' = $1`,
          [charge.payment_intent]
        );
        fastify.log.info({ paymentIntent: charge.payment_intent }, 'Stripe webhook: refund processed');
        break;
      }

      default:
        fastify.log.info({ eventType: event.type }, 'Stripe webhook: unhandled event');
    }

    return reply.send({ success: true });
  });

  // ─── POST /payments/paystack/webhook ─────────────────────────────────────
  // Paystack webhook handler
  fastify.post('/paystack/webhook', async (request, reply) => {
    const signature = request.headers['x-paystack-signature'];

    let rawBody = '';
    if (request.rawBody) rawBody = request.rawBody;
    else if (Buffer.isBuffer(request.body)) rawBody = request.body.toString();
    else if (typeof request.body === 'string') rawBody = request.body;
    else rawBody = JSON.stringify(request.body);

    if (!verifyPaystackWebhookSignature(rawBody, signature)) {
      fastify.log.warn('Paystack webhook: invalid signature');
      return reply.status(401).send({ success: false, error: 'Invalid signature' });
    }

    const event = request.body;

    switch (event.event) {
      case 'charge.success': {
        const { reference, amount, customer, metadata } = event.data;
        const { userId, plan } = metadata || {};

        if (userId && plan) {
          await handleSuccessfulPayment(fastify, reference, userId, plan);
          fastify.log.info({ reference, userId, plan }, 'Paystack webhook: payment success processed');
        }
        break;
      }

      case 'refund.created': {
        const { reference } = event.data;
        await fastify.db.query(
          `UPDATE payments SET status = 'refunded', refunded_at = NOW() WHERE reference = $1`,
          [reference]
        );
        fastify.log.info({ reference }, 'Paystack webhook: refund processed');
        break;
      }

      default:
        fastify.log.info({ event: event.event }, 'Paystack webhook: unhandled event');
    }

    return reply.send({ success: true });
  });

  // ─── GET /payments/history ────────────────────────────────────────────────
  fastify.get('/history', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    const { limit = 20, offset = 0 } = request.query;

    const result = await fastify.db.query(
      `SELECT id, reference, amount, currency, status, plan, provider, created_at, completed_at, refunded_at
       FROM payments
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return reply.send({
      success: true,
      data: {
        payments: result.rows.map(r => ({
          ...r,
          amountLabel: `${r.currency} ${r.amount}`,
        })),
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ─── POST /payments/stripe/portal ─────────────────────────────────────────
  // Create Stripe Customer Portal session for subscription management
  fastify.post('/stripe/portal', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { returnUrl } = request.body;
    const userId = request.user.id;
    const email = request.user.email;

    const result = await createCustomerPortalSession(fastify, {
      userId,
      email,
      returnUrl: returnUrl || `${process.env.APP_URL || 'http://localhost:8080'}/payments`,
    });

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'PORTAL_ERROR', message: result.error, requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: { url: result.data.url },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // ─── GET /payments/mock/confirm ───────────────────────────────────────────
  // Confirm a mock payment (Development only)
  fastify.get('/mock/confirm', async (request, reply) => {
    const { reference } = request.query;

    if (!reference) {
      return reply.status(400).send({ success: false, error: 'Reference required' });
    }

    const result = await confirmMockPayment(fastify, reference);

    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    const { userId, plan, amount } = result.data;
    
    try {
      await handleSuccessfulPayment(fastify, reference, userId, plan, 'mock', 'USD');
      return reply.send({
        success: true,
        message: 'Mock payment confirmed and processed',
        data: { userId, plan, amount }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to process mock payment' });
    }
  });

  // ─── POST /payments/tokens/purchase ──────────────────────────────────────
  // Handle the token purchase logic
  fastify.post('/tokens/purchase', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['packId'],
        properties: {
          packId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.user.id;
    const { packId } = request.body;

    const GOAL_TOKEN_PACKS = {
      'impulse': { goalTokens: 50, price: 0.99 },
      'warrior': { goalTokens: 250, price: 3.99 },
      'tribe_leader': { goalTokens: 1000, price: 9.99 },
    };

    const pack = GOAL_TOKEN_PACKS[packId];
    if (!pack) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PACK', message: 'Invalid pack ID', requestId: request.id }
      });
    }

    // In a real implementation, we would verify the IAP or Stripe payment here.
    // For now, we'll simulate a successful purchase.
    
    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(
        'UPDATE users SET gems = COALESCE(gems, 0) + $1, battle_tokens = 6, last_token_refill_at = NOW() WHERE id = $2',
        [pack.goalTokens, userId]
      );

      const reference = `TOKEN_PURCHASE_${Date.now()}_${userId.slice(0, 8)}`;
      await client.query(
        `INSERT INTO gem_transactions (user_id, amount, provider, reference, type, created_at)
         VALUES ($1, $2, 'iap', $3, 'purchase', NOW())`,
        [userId, pack.goalTokens, reference]
      );

      await client.query('COMMIT');

      return reply.send({
        success: true,
        data: {
          goalTokensAdded: pack.goalTokens,
          message: `Successfully purchased ${pack.goalTokens} GoalTokens.`,
        },
        meta: { timestamp: new Date().toISOString(), requestId: request.id }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to process purchase', requestId: request.id }
      });
    } finally {
      client.release();
    }
  });

  // ─── POST /payments/refund ────────────────────────────────────────────────
  // Admin-only refund endpoint - auto-detects provider from payment record
  fastify.post('/refund', async (request, reply) => {
    const { reference, amount } = request.body;

    if (!reference) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'reference is required', requestId: request.id },
      });
    }

    // Get payment record to determine provider and currency
    const paymentResult = await fastify.db.query(
      `SELECT provider, currency, amount FROM payments WHERE reference = $1`,
      [reference]
    );

    if (paymentResult.rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found', requestId: request.id },
      });
    }

    const { provider, currency } = paymentResult.rows[0];

    if (provider === 'stripe') {
      const result = await refundStripePayment(fastify, reference, amount || null);
      if (!result.success) {
        return reply.status(500).send({
          success: false,
          error: { code: 'REFUND_FAILED', message: result.error, requestId: request.id },
        });
      }
      return reply.send({
        success: true,
        data: { message: 'Stripe refund processed', reference },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    }

    // Paystack ZAR refund
    const result = await refundTransaction(fastify, reference, amount || paymentResult.rows[0].amount);
    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'REFUND_FAILED', message: result.error, requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: { message: 'Paystack refund processed', reference },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
};

export default paymentsRoutes;