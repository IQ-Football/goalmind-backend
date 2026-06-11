/**
 * Tribe War Room Service — Strategic Command Centers
 * Handles Socket.IO namespaces for tribe-only strategy and coordination.
 */

export function setupWarRoomHandlers(io, fastify) {
  const warRoomNamespace = io.of(/^\/war-room\/[0-9a-fA-F-]{36}$/);

  warRoomNamespace.on('connection', async (socket) => {
    const tribeId = socket.nsp.name.split('/').pop();
    let userId = null;

    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('Unauthorized');
      
      const decoded = await fastify.jwt.verify(token);
      userId = decoded.id;

      // Verify user belongs to this tribe
      const memberRes = await fastify.db.query(
        'SELECT 1 FROM users WHERE id = $1 AND tribe_id = $2',
        [userId, tribeId]
      );
      if (memberRes.rows.length === 0) throw new Error('Forbidden');

      socket.userId = userId;
      socket.tribeId = tribeId;

      fastify.log.info({ userId, tribeId }, 'User joined Tribe War Room');

      socket.on('strategy:message', async (data) => {
        const { text, type = 'text' } = data;
        if (!text) return;

        const message = {
          userId: socket.userId,
          text,
          type,
          timestamp: new Date().toISOString()
        };

        // Broadcast to entire war room
        warRoomNamespace.to(socket.nsp.name).emit('strategy:broadcast', message);

        // Persist to Redis (last 50 messages)
        const redisKey = `war-room:messages:${tribeId}`;
        await fastify.redis.lpush(redisKey, JSON.stringify(message));
        await fastify.redis.ltrim(redisKey, 0, 49);
      });

      socket.on('disconnect', () => {
        fastify.log.info({ userId, tribeId }, 'User left Tribe War Room');
      });

    } catch (err) {
      fastify.log.warn({ err: err.message }, 'War Room connection rejected');
      socket.disconnect();
    }
  });
}

/**
 * Fetch War Room data for a specific tribe.
 */
export async function getWarRoomData(fastify, tribeSlug) {
  const tribeResult = await fastify.db.query(
    'SELECT id, name, slug, total_points, member_count FROM tribes WHERE slug = $1',
    [tribeSlug]
  );

  if (tribeResult.rows.length === 0) {
    throw new Error('TRIBE_NOT_FOUND');
  }

  const tribe = tribeResult.rows[0];

  // Fetch recent strategic messages from Redis (last 50)
  const messages = await fastify.redis.lrange(`war-room:messages:${tribe.id}`, 0, 49);

  return {
    tribe,
    messages: messages.map(m => JSON.parse(m)),
    onlineCount: 0 // This would be dynamic in a real implementation
  };
}
