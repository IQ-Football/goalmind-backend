import { startRelayMatch } from '../services/relayService.js';

export default async function relayRoutes(fastify) {
  fastify.post('/:id/start', async (request, reply) => {
    const { id } = request.params;
    const namespace = fastify.io.of('/relay');
    await startRelayMatch(id, fastify, namespace);
    return { status: 'started', relayId: id };
  });
}
