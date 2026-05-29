import pg from 'pg';
import config from '../src/config.js';
import { awardFoundingGeneral } from '../src/services/achievementService.js';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: node award_fg.js <user_id>');
  process.exit(1);
}

const fastify = {
  db: new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name
  }),
  log: console
};

try {
  const result = await awardFoundingGeneral(fastify, userId);
  console.log('Result:', result);
} catch (err) {
  console.error('Error:', err);
} finally {
  await fastify.db.end();
}
