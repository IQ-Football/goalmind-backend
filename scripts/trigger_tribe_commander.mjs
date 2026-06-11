
import pg from 'pg';
const { Pool } = pg;
import config from '../src/config.js';
import { awardTribeCommander } from '../src/services/achievementService.js';

const fastify = {
  db: {
    query: async (text, params) => {
      const pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
      });
      const res = await pool.query(text, params);
      await pool.end();
      return res;
    },
    connect: async () => {
      const pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
      });
      const client = await pool.connect();
      const originalRelease = client.release;
      client.release = () => {
        originalRelease.apply(client);
        return pool.end();
      };
      return client;
    }
  },
  log: {
    info: console.log,
    error: console.error,
    debug: console.log
  }
};

const tribeId = '92bb68bb-dd1a-4e3f-b9a2-4c795ec8d219'; // Al Ahly

async function run() {
  console.log('Awarding Tribe Commander for Al Ahly...');
  const res = await awardTribeCommander(fastify, tribeId);
  console.log('Result:', res);
}

run().catch(console.error);
