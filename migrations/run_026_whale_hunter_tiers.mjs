
import pg from 'pg';
import config from '../src/config.js';
const { Pool } = pg;

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: String(config.database.password || ''),
  database: config.database.name
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting Whale Hunter Tiers migration...');

    // 1. Ensure oracle_status and last_herald_horn_at exist in users
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oracle_status CHARACTER VARYING;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_herald_horn_at TIMESTAMP WITH TIME ZONE;
    `);
    console.log('User columns OK');

    // 2. Add new badges
    const newBadges = [
      { name: "Silver Oracle", slug: "silver_oracle", description: "Awarded for 5,000 successful referrals." },
      { name: "Gold Oracle", slug: "gold_oracle", description: "Awarded for 10,000 successful referrals." },
      { name: "Obsidian Oracle", slug: "obsidian_oracle", description: "Awarded for 20,000 successful referrals." },
      { name: "Herald's Horn", slug: "herald_horn", description: "The power to rally the entire Arena." }
    ];

    for (const badge of newBadges) {
      await client.query(`
        INSERT INTO badges (id, name, slug, description, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, NOW())
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description
      `, [badge.name, badge.slug, badge.description]);
    }
    console.log('Badges seeded OK');

    console.log('Migration complete');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
