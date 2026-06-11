import { getCurrentWave, getDominance, activateStoneWall, activateSalvo, GIZA_SECTORS } from '../services/imperialConflictService.js';
import { authenticate } from '../middleware/auth.js';

const imperialConflictRoutes = async (fastify, options) => {
  fastify.addHook('preHandler', authenticate);

  // GET /imperial-conflict/status - Get current wave and sector dominance
  fastify.get('/status', async (request, reply) => {
    const wave = await getCurrentWave();
    const sectors = wave ? GIZA_SECTORS[wave] : [];
    
    const sectorStats = await Promise.all(sectors.map(async (sector) => {
      const dominance = await getDominance(fastify, sector);
      return { sector, ...dominance };
    }));

    return reply.send({
      success: true,
      data: {
        wave,
        sectors: sectorStats
      }
    });
  });

  // POST /imperial-conflict/stone-wall - Activate Stone Wall command
  fastify.post('/stone-wall', async (request, reply) => {
    const { tribeId, sector } = request.body;
    const userId = request.user.id;

    try {
      await activateStoneWall(fastify, userId, tribeId, sector);
      return reply.send({
        success: true,
        message: `Stone Wall activated in ${sector}!`
      });
    } catch (err) {
      if (err.message === 'UNAUTHORIZED_COMMANDER') {
        return reply.status(403).send({ success: false, message: 'Only Founding Generals or Tribe Commanders can activate tactical commands.' });
      }
      if (err.message === 'SECTOR_NOT_HELD_IN_PREVIOUS_WAVE') {
        return reply.status(400).send({ success: false, message: 'Stone Wall can only be activated on sectors held in the previous wave.' });
      }
      if (err.message === 'INSUFFICIENT_VAULT_FUNDS') {
        return reply.status(400).send({ success: false, message: 'Insufficient GT in Tribe Vault.' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ success: false, message: 'Internal Server Error' });
    }
  });

  // POST /imperial-conflict/salvo - Activate Salvo command
  fastify.post('/salvo', async (request, reply) => {
    const { tribeId, sector } = request.body;
    const userId = request.user.id;

    try {
      await activateSalvo(fastify, userId, tribeId, sector);
      return reply.send({
        success: true,
        message: `Salvo strike called on ${sector}!`
      });
    } catch (err) {
      if (err.message === 'UNAUTHORIZED_COMMANDER') {
        return reply.status(403).send({ success: false, message: 'Only Founding Generals or Tribe Commanders can activate tactical commands.' });
      }
      if (err.message === 'INSUFFICIENT_VAULT_FUNDS') {
        return reply.status(400).send({ success: false, message: 'Insufficient GT in Tribe Vault.' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ success: false, message: 'Internal Server Error' });
    }
  });
};

export default imperialConflictRoutes;
