
import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

const updates = [
  {
    name: 'Tribal Spark',
    slug: 'tribal-spark',
    badge_url: '/assets/badges/tribal_spark.png'
  },
  {
    name: 'Deadlock Breaker',
    slug: 'deadlock-breaker',
    badge_url: '/assets/badges/deadlock_breaker.png'
  },
  {
    name: 'Founding Captain',
    slug: 'founding-captain',
    badge_url: '/assets/badges/founding_captain.png'
  },
  {
    name: 'Founding General',
    slug: 'founding-general',
    badge_url: '/assets/badges/founding_general.png'
  },
  {
    name: 'Founding Pro',
    slug: 'founding-pro',
    badge_url: '/assets/badges/founding_pro.png'
  }
];

const tribalWarlord = {
  id: '550e8400-e29b-41d4-a716-446655440004',
  name: 'Tribal Warlord',
  description: 'Awarded to tribe members who reach the rank of Warlord General.',
  badge_url: '/assets/badges/tribal_warlord.png',
  slug: 'tribal-warlord',
  tier: 'elite',
  criteria: {
    type: 'seniority',
    level: 'Warlord General'
  }
};

async function run() {
  try {
    for (const update of updates) {
      console.log(`Updating ${update.name}...`);
      await pool.query(
        'UPDATE achievements SET slug = $1, badge_url = $2 WHERE name = $3',
        [update.slug, update.badge_url, update.name]
      );
    }

    console.log('Inserting/Updating Tribal Warlord...');
    await pool.query(
      `INSERT INTO achievements (id, name, description, badge_url, slug, tier, criteria)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         badge_url = EXCLUDED.badge_url,
         slug = EXCLUDED.slug,
         tier = EXCLUDED.tier,
         criteria = EXCLUDED.criteria`,
      [
        tribalWarlord.id,
        tribalWarlord.name,
        tribalWarlord.description,
        tribalWarlord.badge_url,
        tribalWarlord.slug,
        tribalWarlord.tier,
        tribalWarlord.criteria
      ]
    );

    console.log('All updates complete.');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
