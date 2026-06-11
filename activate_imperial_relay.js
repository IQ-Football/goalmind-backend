
import Fastify from 'fastify';
import redisPlugin from './src/plugins/redis.js';
import { createRelayMatch } from './src/services/relayService.js';
import dbPlugin from './src/plugins/db.js';

const fastify = Fastify();
fastify.register(dbPlugin);
fastify.register(redisPlugin);

const AL_AHLY_ID = '92bb68bb-dd1a-4e3f-b9a2-4c795ec8d219';
const WYDAD_ID = 'fb27a4d2-79a2-43f4-8097-a8c1f517b354';

async function run() {
  await fastify.ready();
  
  console.log(`Starting Imperial Relay: Al Ahly vs Wydad Casablanca...`);
  
  const relayId = await createRelayMatch(fastify, AL_AHLY_ID, WYDAD_ID);
  
  console.log('Successfully created Imperial Relay match!');
  console.log('Relay ID:', relayId);
  
  // Set a special name or metadata if possible? 
  // For now, just the creation is enough to show in the UI.
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
