
/**
 * Mock Payment Service for Development
 * Simulates a payment provider for testing the Pro upgrade flow
 */

export async function initializeMockPayment(fastify, { userId, amount, email, plan, callbackUrl }) {
  const reference = `MOCK_${Date.now()}_${userId.slice(0, 8)}`;
  
  // Store pending payment
  await fastify.db.query(
    `INSERT INTO payments (reference, user_id, amount, currency, status, plan, provider, metadata)
     VALUES ($1, $2, $3, 'USD', 'pending', $4, 'mock', $5)`,
    [reference, userId, amount, plan, JSON.stringify({ is_mock: true })]
  );

  return {
    success: true,
    data: {
      authorizationUrl: `${process.env.APP_URL || 'http://localhost:8080'}/payments/mock/confirm?reference=${reference}`,
      reference,
      amount,
      currency: 'USD'
    }
  };
}

export async function confirmMockPayment(fastify, reference) {
  const result = await fastify.db.query(
    `SELECT * FROM payments WHERE reference = $1 AND provider = 'mock'`,
    [reference]
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Payment not found' };
  }

  const payment = result.rows[0];
  if (payment.status !== 'pending') {
    return { success: false, error: 'Payment already processed' };
  }

  return {
    success: true,
    data: {
      reference: payment.reference,
      userId: payment.user_id,
      plan: payment.plan,
      amount: payment.amount,
      status: 'success'
    }
  };
}

export default {
  initializeMockPayment,
  confirmMockPayment
};
