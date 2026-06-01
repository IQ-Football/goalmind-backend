import Fastify from 'fastify';
import dbPlugin from '../plugins/db.js';

const fastify = Fastify({ logger: true });

async function run() {
  try {
    await fastify.register(dbPlugin);
    await fastify.ready();

    const queries = [
      `CREATE TABLE IF NOT EXISTS shop_products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price_zar DECIMAL(10, 2),
        price_gbp DECIMAL(10, 2),
        price_eur DECIMAL(10, 2),
        goal_tokens INTEGER DEFAULT 0,
        category VARCHAR(20) NOT NULL,
        metadata JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      `INSERT INTO shop_products (id, name, description, price_zar, price_gbp, price_eur, goal_tokens, category)
       VALUES 
        ('gt_impulse', 'Impulse Pack', 'Quick recharge for active players.', 19.99, 0.99, 0.99, 50, 'tokens'),
        ('gt_warrior', 'Warrior Stash', 'Most popular choice for daily battles.', 89.99, 3.99, 4.49, 250, 'tokens'),
        ('gt_tribe_leader', 'Tribe Leader Hoard', 'Maximum value for tribal dominance.', 199.99, 9.99, 10.99, 1000, 'tokens'),
        ('bp_season_1', 'Battle Pass: Season 1', 'Unlock exclusive rewards and permanent Founding Pro status.', 39.99, 1.99, 2.49, 200, 'battle_pass')
       ON CONFLICT (id) DO UPDATE SET
        price_zar = EXCLUDED.price_zar,
        price_gbp = EXCLUDED.price_gbp,
        price_eur = EXCLUDED.price_eur,
        goal_tokens = EXCLUDED.goal_tokens`
    ];

    for (const sql of queries) {
      console.log(`Executing: ${sql}`);
      await fastify.db.query(sql);
    }

    console.log("Shop migration successful.");
    process.exit(0);
  } catch (err) {
    console.error('Shop migration failed:', err);
    process.exit(1);
  }
}

run();
