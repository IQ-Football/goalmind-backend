
import Fastify from 'fastify';
import redisPlugin from './src/plugins/redis.js';
import { createRelayMatch } from './src/services/relayService.js';
import dbPlugin from './src/plugins/db.js';

const fastify = Fastify();
fastify.register(dbPlugin);
fastify.register(redisPlugin);

async function run() {
  await fastify.ready();
  
  // Get two tribes
  const tribes = await fastify.db.query('SELECT id FROM tribes LIMIT 2');
  if (tribes.rows.length < 2) {
    console.error('Not enough tribes in DB');
    process.exit(1);
  }
  
  const relayId = await createRelayMatch(fastify, tribes.rows[0].id, tribes.rows[1].id);
  console.log('Created relay match:', relayId);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
