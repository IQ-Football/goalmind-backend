
import pg from 'pg';
const { Client } = pg;

async function seedAchievements() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    console.log('Seeding achievements...');

    const achievements = [
      {
        name: 'Deadlock Breaker',
        slug: 'deadlock-breaker',
        description: 'Awarded to the first 50 members of a tribe that broke a zero-signup deadlock and reached 50 signups within 72 hours.',
        badge_url: 'https://cdn.goalmind.io/badges/deadlock_breaker.png',
        criteria: { type: 'tribe_catchup', count: 50, window_hours: 72 },
        tier: 'Limited Edition'
      },
      {
        name: 'Tribal Spark',
        slug: 'tribal-spark',
        description: 'Awarded to the very first user to register for a tribe that was at zero.',
        badge_url: 'https://cdn.goalmind.io/badges/tribal_spark.png',
        criteria: { type: 'zero_breaker' },
        tier: 'Ultra-Rare'
      }
    ];

    for (const ach of achievements) {
      await client.query(`
        INSERT INTO achievements (name, slug, description, badge_url, criteria, tier)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          badge_url = EXCLUDED.badge_url,
          criteria = EXCLUDED.criteria,
          tier = EXCLUDED.tier
      `, [ach.name, ach.slug, ach.description, ach.badge_url, ach.criteria, ach.tier]);
      console.log(`Achievement ${ach.name} seeded.`);
    }

    // Update existing achievements with slugs if possible
    // For example, if 'Founding General' exists without a slug
    await client.query(`
      UPDATE achievements SET slug = 'founding-general' WHERE name = 'Founding General' AND slug IS NULL;
    `);

    console.log('Seeding completed successfully.');
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    await client.end();
  }
}

seedAchievements();
