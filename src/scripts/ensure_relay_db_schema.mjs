import Fastify from 'fastify';
import config from '../config.js';
import dbPlugin from '../plugins/db.js';

const fastify = Fastify({ logger: true });

async function run() {
  try {
    await fastify.register(dbPlugin);
    await fastify.ready();

    const queries = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_tokens INTEGER DEFAULT 0",
      "ALTER TABLE tribes ADD COLUMN IF NOT EXISTS anthem_url VARCHAR(500)",
      "ALTER TABLE tribes ADD COLUMN IF NOT EXISTS seasonal_skin_enabled BOOLEAN DEFAULT false",
      `CREATE TABLE IF NOT EXISTS hall_of_generals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        tribe_id UUID REFERENCES tribes(id),
        reason TEXT,
        inducted_at TIMESTAMPTZ DEFAULT NOW()
      )`
    ];

    for (const sql of queries) {
      console.log(`Executing: ${sql}`);
      await fastify.db.query(sql);
    }

    console.log("Migration successful.");
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
