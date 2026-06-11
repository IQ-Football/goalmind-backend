/**
 * Migration 027: Lagos Surge - Eko Vanguard & Multipliers
 */
const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting Lagos Surge migration...');

    // 1. Add Eko Vanguard Badge
    const ekoVanguardBadgeId = '770e8400-e29b-41d4-a716-446655440005';
    await client.query(`
      INSERT INTO achievements (id, name, description, criteria, tier)
      VALUES ($1, 'Eko Vanguard', 'Awarded to early supporters of the Lagos Surge.', '{"type": "purchase", "sku": "pro_starter"}', 'Rare')
      ON CONFLICT (id) DO NOTHING
    `, [ekoVanguardBadgeId]);
    console.log('Eko Vanguard badge OK');

    // 2. Add multiplier columns to users
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS active_multiplier NUMERIC(4,2) DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS multiplier_expires_at TIMESTAMP WITH TIME ZONE;
    `);
    console.log('User multiplier columns OK');

    console.log('Migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
