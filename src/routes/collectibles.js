import { authenticate } from '../middleware/auth.js';
import {
  getCollectiblesCatalog,
  getCollectiblesByType,
  getUserCollectibles,
  getUserEquipped,
  equipCollectible,
  unequipCollectible,
  claimCollectibleMock,
} from '../services/collectiblesService.js';

const collectibleRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /collectibles/catalog — List all available collectibles (shop/gallery)
  fastify.get('/catalog', async (request, reply) => {
    try {
      const catalog = getCollectiblesCatalog();
      return reply.send({
        success: true,
        data: {
          collectibles: catalog,
          total: catalog.length,
        },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch catalog', requestId: request.id },
      });
    }
  });

  // GET /collectibles/types/:type — List collectibles by type (moment_card, ultra_banner, tribe_skin)
  fastify.get('/types/:type', async (request, reply) => {
    const { type } = request.params;
    const validTypes = ['moment_card', 'ultra_banner', 'tribe_skin'];
    if (!validTypes.includes(type)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_TYPE', message: `Type must be one of: ${validTypes.join(', ')}`, requestId: request.id },
      });
    }

    try {
      const collectibles = getCollectiblesByType(type);
      return reply.send({
        success: true,
        data: { collectibles },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch collectibles', requestId: request.id },
      });
    }
  });

  // GET /collectibles/mine — List user's owned collectibles
  fastify.get('/mine', async (request, reply) => {
    try {
      const collectibles = await getUserCollectibles(fastify, request.user.id);
      return reply.send({
        success: true,
        data: {
          collectibles,
          totalOwned: collectibles.length,
        },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch collectibles', requestId: request.id },
      });
    }
  });

  // GET /collectibles/equipped — Get user's currently equipped items
  fastify.get('/equipped', async (request, reply) => {
    try {
      const equipped = await getUserEquipped(fastify, request.user.id);
      return reply.send({
        success: true,
        data: { equipped },
        meta: { timestamp: new Date().toISOString(), requestId: request.id },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch equipped items', requestId: request.id },
      });
    }
  });

  // POST /collectibles/:id/equip — Equip a collectible (banner or skin)
  fastify.post('/:id/equip', async (request, reply) => {
    const { id } = request.params;

    const result = await equipCollectible(fastify, request.user.id, id);

    if (!result.success) {
      if (result.reason === 'not_found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Collectible not found in catalog', requestId: request.id },
        });
      }
      if (result.reason === 'not_equippable') {
        return reply.status(400).send({
          success: false,
          error: { code: 'NOT_EQUIPPABLE', message: 'This collectible type cannot be equipped', requestId: request.id },
        });
      }
      if (result.reason === 'not_owned') {
        return reply.status(403).send({
          success: false,
          error: { code: 'NOT_OWNED', message: 'You do not own this collectible', requestId: request.id },
        });
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to equip collectible', requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: { message: 'Collectible equipped successfully', collectible_id: id },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // POST /collectibles/:id/unequip — Unequip a collectible
  fastify.post('/:id/unequip', async (request, reply) => {
    const { id } = request.params;

    const result = await unequipCollectible(fastify, request.user.id, id);

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to unequip collectible', requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: { message: 'Collectible unequipped successfully', collectible_id: id },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });

  // POST /collectibles/:id/claim — Mock claim endpoint for testing
  // NOTE: In production this would be replaced by achievement-triggered grants
  fastify.post('/:id/claim', async (request, reply) => {
    const { id } = request.params;

    const result = await claimCollectibleMock(fastify, request.user.id, id);

    if (!result.success) {
      if (result.reason === 'not_found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Collectible not found', requestId: request.id },
        });
      }
      if (result.reason === 'already_owned') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_OWNED', message: 'You already own this collectible', requestId: request.id },
        });
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to claim collectible', requestId: request.id },
      });
    }

    return reply.send({
      success: true,
      data: {
        message: 'Collectible claimed successfully!',
        collectible: result.collectible,
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
};

export default collectibleRoutes;
