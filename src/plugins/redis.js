import fp from 'fastify-plugin';
import Redis from 'ioredis';
import config from '../config.js';

async function redisPlugin(fastify, options) {
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    lazyConnect: true,
  });

  try {
    await redis.connect();
    fastify.log.info('Redis connected successfully');
  } catch (err) {
    fastify.log.error('Redis connection failed:', err.message);
  }

  // Decorate fastify with redis methods
  fastify.decorate('redis', redis);

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    await redis.quit();
    fastify.log.info('Redis connection closed');
  });
}

export default fp(redisPlugin);
