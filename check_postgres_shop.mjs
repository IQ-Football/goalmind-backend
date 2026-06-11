import Fastify from 'fastify';
import dbPlugin from './src/plugins/db.js';

const fastify = Fastify();

async function run() {
  await fastify.register(dbPlugin);
  await fastify.ready();
  try {
    const res = await fastify.db.query('SELECT id, name FROM shop_products');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
