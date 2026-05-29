import Redis from 'ioredis';
import config from '../src/config.js';

async function seed() {
  const redis = new Redis(config.redis.url);
  console.log('Connecting to Redis...');

  const participantsA = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const participantsB = ['p6', 'p7', 'p8', 'p9', 'p10'];
  
  const relayId = 'test-relay-id';
  
  console.log(`Seeding relay match ${relayId}...`);
  
  await redis.hset(`relay:${relayId}:state`, {
    tribeA_id: 'tribe-a',
    tribeB_id: 'tribe-b',
    status: 'lobby',
    active_player_index: '0',
    active_tribe: 'A',
    current_round: '0',
    tribeA_score: '0',
    tribeB_score: '0',
    tribeA_participants: JSON.stringify(participantsA),
    tribeB_participants: JSON.stringify(participantsB),
    tribeA_online: JSON.stringify([]),
    tribeB_online: JSON.stringify([]),
    startTime: String(Date.now()),
  });

  console.log(`Relay match ${relayId} seeded and set to 'lobby' state.`);
  
  await redis.quit();
  process.exit(0);
}

seed().catch(console.error);
