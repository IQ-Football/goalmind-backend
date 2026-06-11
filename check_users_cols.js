import Fastify from 'fastify';
import dbPlugin from './src/plugins/db.js';

const fastify = Fastify();

async function checkColumns() {
  await fastify.register(dbPlugin);
  await fastify.ready();
  
  const res = await fastify.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
  console.log(res.rows.map(r => r.column_name));
  process.exit(0);
}

checkColumns();
