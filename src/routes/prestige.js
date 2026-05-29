/**
 * Prestige & Hall of Fame Routes
 * 
 * Endpoints:
 * POST /users/me/prestige                  — Reset ELO to 1200, gain star, unlock slot
 * GET  /users/:id/hall-of-fame            — Get user's Hall of Fame
 * POST /users/me/hall-of-fame             — Add item to a slot
 * DELETE /users/me/hall-of-fame/:slot     — Remove from a slot
 */

import { authenticate } from '../middleware/auth.js';
import {
  prestigeUser,
  addToHallOfFame,
  getUserHallOfFame,
  removeFromHallOfFame,
  ensureHallOfFameTable,
} from '../services/prestigeHallOfFameService.js';

const prestigeRoutes = async (fastify, options) => {

  // Ensure Hall of Fame table on startup
  await ensureHallOfFameTable(fastify);

  // POST /users/me/prestige — Perform prestige reset (GOAT → 1200 ELO)
  fastify.post('/me/prestige', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      const result = await prestigeUser(fastify, userId);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: { code: result.error, message: result.message } });
      }
      return reply.send(result);
    } catch (err) {
      fastify.log.error('prestige error:', err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to prestige' } });
    }
  });

  // GET /users/:id/hall-of-fame — Get user's Hall of Fame
  fastify.get('/users/:id/hall-of-fame', { preHandler: authenticate }, async (request, reply) => {
    const targetUserId = request.params.id;
    const requestingUserId = request.user.id;
    try {
      const result = await getUserHallOfFame(fastify, targetUserId, requestingUserId);
      return reply.send(result);
    } catch (err) {
      fastify.log.error('hall-of-fame get error:', err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch Hall of Fame' } });
    }
  });

  // POST /users/me/hall-of-fame — Add item to Hall of Fame slot
  fastify.post('/me/hall-of-fame', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    const { slotIndex, itemType, itemId, title, comment, relicMetadata } = request.body || {};

    if (!slotIndex || !itemType || !itemId || !title) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'slotIndex, itemType, itemId, and title are required' },
      });
    }
    if (!['match', 'trivia_set', 'achievement'].includes(itemType)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ITEM_TYPE', message: 'itemType must be match, trivia_set, or achievement' },
      });
    }
    try {
      const result = await addToHallOfFame(fastify, userId, { slotIndex, itemType, itemId, title, comment, relicMetadata });
      if (!result.success) {
        return reply.status(400).send({ success: false, error: { code: result.error, message: result.message } });
      }
      return reply.status(201).send(result);
    } catch (err) {
      fastify.log.error('hall-of-fame add error:', err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to add to Hall of Fame' } });
    }
  });

  // DELETE /users/me/hall-of-fame/:slotIndex — Remove entry from slot
  fastify.delete('/me/hall-of-fame/:slotIndex', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    const slotIndex = parseInt(request.params.slotIndex, 10);
    if (isNaN(slotIndex)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_SLOT', message: 'slotIndex must be a number' } });
    }
    try {
      const result = await removeFromHallOfFame(fastify, userId, slotIndex);
      if (!result.success) {
        return reply.status(404).send({ success: false, error: { code: result.error, message: 'Entry not found' } });
      }
      return reply.send({ success: true });
    } catch (err) {
      fastify.log.error('hall-of-fame delete error:', err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to remove from Hall of Fame' } });
    }
  });
};

export default prestigeRoutes;