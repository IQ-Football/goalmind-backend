import { authenticate } from '../middleware/auth.js';
import { shopService } from '../services/shopService.js';

/**
 * Shop Routes - GoalMind Competitive Store
 * POST /shop/purchase - Skill-based acquisition
 * GET /shop/catalog - Browse the arsenal
 */
const shopRoutes = async (fastify, options) => {

  // ─── GET /shop/catalog ───────────────────────────────────────────────────
  // Returns all available products for the current user
  fastify.get('/catalog', async (request, reply) => {
    try {
      const catalog = await shopService.getCatalog(fastify);
      return reply.send({
        success: true,
        data: {
          items: catalog
        },
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch catalog' }
      });
    }
  });

  // ─── POST /shop/purchase ──────────────────────────────────────────────────
  // Handles the purchase of a shop product
  fastify.post('/purchase', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['productId'],
        properties: {
          productId: { type: 'string' },
          provider: { type: 'string', enum: ['paystack', 'stripe', 'iap', 'mock'], default: 'mock' },
          reference: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { productId, provider, reference } = request.body;
    const userId = request.user.id;

    try {
      const result = await shopService.purchaseProduct(fastify, {
        userId,
        productId,
        provider,
        reference
      });

      return reply.send({
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() }
      });
    } catch (err) {
      const statusCode = err.message === 'Product not found' ? 404 : 400;
      return reply.status(statusCode).send({
        success: false,
        error: { 
          code: statusCode === 404 ? 'PRODUCT_NOT_FOUND' : 'PURCHASE_FAILED', 
          message: err.message 
        }
      });
    }
  });
};

export default shopRoutes;
