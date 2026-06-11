import Fastify from 'fastify';
import dbPlugin from './src/plugins/db.js';

const fastify = Fastify();

async function run() {
  await fastify.register(dbPlugin);
  await fastify.ready();
  const res = await fastify.db.query("SELECT * FROM achievements WHERE id = '4b6c8914-87be-47ea-8942-d64e9a8f2765'");
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}

run();
