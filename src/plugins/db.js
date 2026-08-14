import fp from 'fastify-plugin';
import pg from 'pg';
import config from '../config.js';

const { Pool } = pg;

async function dbPlugin(fastify, options) {
  const poolConfig = config.database.url
    ? { connectionString: config.database.url }
    : {
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
      };
  const pool = new Pool({
    ...poolConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Increased from 2000ms for stability
    ssl: config.database.ssl,
  });

  // Test connection
  try {
    const client = await pool.connect();
    fastify.log.info('PostgreSQL connected successfully');
    client.release();
  } catch (err) {
    fastify.log.error('PostgreSQL connection failed:', err.message);
  }

  // Decorate fastify with db methods
  fastify.decorate('db', {
    query: async (text, params) => {
      const start = Date.now();
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      fastify.log.debug({ query: text, duration, rows: result.rowCount }, 'database query');
      return result;
    },
    connect: () => pool.connect(),
    getClient: () => pool.connect(),
    pool,
  });

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    await pool.end();
    fastify.log.info('PostgreSQL connection pool closed');
  });
}

export default fp(dbPlugin);
