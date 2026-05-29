import { Pool } from 'pg';
import config from '../src/config.js';
import leagueSystemService from '../src/services/leagueSystemService.js';

const fastify = {
  db: new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  }),
  log: console
};

async function run() {
  try {
    console.log('Running Season 1 Ranked Seeding...');
    await leagueSystemService.seed5TierLeagues(fastify);
    console.log('Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

run();
