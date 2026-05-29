import Fastify from 'fastify';
import config from '../config.js';
import dbPlugin from '../plugins/db.js';
import redisPlugin from '../plugins/redis.js';
import { distributeSeasonalRewards } from '../services/rewardService.js';

const fastify = Fastify({ logger: true });

async function run() {
  try {
    await fastify.register(dbPlugin);
    await fastify.register(redisPlugin);
    await fastify.ready();

    const leagueId = process.argv[2];
    const seasonId = process.argv[3];

    if (!leagueId || !seasonId) {
      console.error('Usage: node distribute_seasonal_rewards.mjs <leagueId> <seasonId>');
      process.exit(1);
    }

    console.log(`Starting reward distribution for league ${leagueId}, season ${seasonId}...`);
    const result = await distributeSeasonalRewards(fastify, leagueId, seasonId);
    console.log(`Successfully distributed rewards to ${result.count} users.`);

    process.exit(0);
  } catch (err) {
    console.error('Reward distribution failed:', err);
    process.exit(1);
  }
}

run();
