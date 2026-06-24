import axios from 'axios';
import crypto from 'crypto';

/**
 * Konnect Tunisia Payment Service
 * Handles TND transactions
 */
const konnectService = {
  /**
   * Initialize a Konnect payment
   */
  initializePayment: async (fastify, { userId, amount, currency, email, plan, callbackUrl }) => {
    const apiKey = process.env.KONNECT_API_KEY;
    const walletId = process.env.KONNECT_WALLET_ID;
    const baseUrl = 'https://api.konnect.network/api/v2';

    if (!apiKey || !walletId) {
      fastify.log.error('Konnect configuration missing');
      throw new Error('Konnect configuration missing');
    }

    try {
      // Create a pending payment record in our DB first
      const reference = `kon_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
      
      await fastify.db.query(
        `INSERT INTO payments (user_id, amount, currency, status, reference, plan, provider)
         VALUES ($1, $2, $3, 'pending', $4, $5, 'konnect')`,
        [userId, amount, currency, reference, plan]
      );

      // Call Konnect API to initialize payment
      // Note: Konnect expects amount in DT (not millimes) or millimes depending on version. 
      // V2 usually expects millimes (amount * 1000).
      const response = await axios.post(
        `${baseUrl}/payments/init-payment`,
        {
          receiverWalletId: walletId,
          amount: Math.round(amount * 1000), // TND to millimes
          token: 'TND',
          firstName: 'GoalMind', // We could get this from user profile
          lastName: 'User',
          email: email,
          orderId: reference,
          acceptedPaymentMethods: ['bank_card', 'e-dinar', 'flouci', 'mobicash'],
          callbackUrl: `${process.env.APP_URL}/api/payments/konnect/webhook`,
          successUrl: `${process.env.APP_URL}/payment/success?reference=${reference}`,
          failUrl: `${process.env.APP_URL}/payment/fail?reference=${reference}`,
        },
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
        data: {
          authorization_url: response.data.payUrl,
          reference: reference,
          paymentId: response.data.paymentId
        }
      };
    } catch (err) {
      fastify.log.error({ err: err.response?.data || err.message }, 'Konnect initialization failed');
      return { success: false, error: err.message };
    }
  },

  /**
   * Verify Konnect payment status
   */
  verifyPayment: async (fastify, paymentId) => {
    const apiKey = process.env.KONNECT_API_KEY;
    const baseUrl = 'https://api.konnect.network/api/v2';

    try {
      const response = await axios.get(
        `${baseUrl}/payments/${paymentId}`,
        {
          headers: { 'x-api-key': apiKey }
        }
      );

      const payment = response.data.payment;
      return {
        success: true,
        status: payment.status, // 'completed', 'pending', 'failed'
        amount: payment.amount / 1000,
        reference: payment.orderId
      };
    } catch (err) {
      fastify.log.error({ err: err.response?.data || err.message }, 'Konnect verification failed');
      return { success: false, error: err.message };
    }
  }
};

export default konnectService;
