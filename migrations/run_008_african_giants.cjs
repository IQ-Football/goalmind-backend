/**
 * Migration 008: African Giants - Scoring Infrastructure
 * CommonJS migration script.
 *
 * Creates:
 * - waitlist_signups, avg_fan_iq, daily_engagement_points, region, is_super_tribe columns on tribes
 * - daily_engagement_streaks table (per-user daily engagement tracking)
 * - Seed 12 African Giants tribes with rivalry configurations
 */

const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

const AFRICAN_GIANTS = [
  // North Africa
  { name: 'Al Ahly SC',           slug: 'al-ahly',             type: 'club', primary_color: '#CE1126', secondary_color: '#FFFFFF', region: 'North Africa',    rivalry_slugs: ['zamalek'] },
  { name: 'Zamalek SC',           slug: 'zamalek',             type: 'club', primary_color: '#FFFFFF', secondary_color: '#000000', region: 'North Africa',    rivalry_slugs: ['al-ahly'] },
  { name: 'Raja Casablanca',      slug: 'raja-casablanca',    type: 'club', primary_color: '#006633', secondary_color: '#FFFFFF', region: 'North Africa',    rivalry_slugs: ['wydad-casablanca'] },
  { name: 'Wydad Casablanca',     slug: 'wydad-casablanca',   type: 'club', primary_color: '#CC0000', secondary_color: '#FFFFFF', region: 'North Africa',    rivalry_slugs: ['raja-casablanca'] },
  { name: 'Espérance de Tunis',   slug: 'esperance-de-tunis', type: 'club', primary_color: '#FFD700', secondary_color: '#000000', region: 'North Africa',    rivalry_slugs: [] },
  // East & Central Africa
  { name: 'Simba SC',             slug: 'simba-sc',           type: 'club', primary_color: '#FFCC00', secondary_color: '#000000', region: 'East Africa',     rivalry_slugs: ['yanga-sc'] },
  { name: 'Young Africans SC',    slug: 'yanga-sc',           type: 'club', primary_color: '#006400', secondary_color: '#FFD700', region: 'East Africa',     rivalry_slugs: ['simba-sc'] },
  { name: 'TP Mazembe',           slug: 'tp-mazembe',         type: 'club', primary_color: '#000000', secondary_color: '#FFCC00', region: 'Central Africa', rivalry_slugs: [] },
  // Southern Africa
  { name: 'Kaizer Chiefs',        slug: 'kaizer-chiefs',      type: 'club', primary_color: '#F2C12E', secondary_color: '#006400', region: 'Southern Africa', rivalry_slugs: ['orlando-pirates'] },
  { name: 'Orlando Pirates',      slug: 'orlando-pirates',    type: 'club', primary_color: '#000000', secondary_color: '#FFFFFF', region: 'Southern Africa', rivalry_slugs: ['kaizer-chiefs'] },
  { name: 'Mamelodi Sundowns',    slug: 'mamelodi-sundowns',  type: 'club', primary_color: '#003366', secondary_color: '#FFFFFF', region: 'Southern Africa', rivalry_slugs: [] },
  // West Africa
  { name: 'Asante Kotoko',        slug: 'asante-kotoko',      type: 'club', primary_color: '#FF6600', secondary_color: '#000000', region: 'West Africa',     rivalry_slugs: [] },
];

async function migrate() {
  console.log('Starting African Giants migration...');
  const client = await pool.connect();

  try {
    // 1. Add scoring columns to tribes table
    await client.query(`
      ALTER TABLE tribes
        ADD COLUMN IF NOT EXISTS waitlist_signups INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS avg_fan_iq NUMERIC(6,2) DEFAULT 0.0,
        ADD COLUMN IF NOT EXISTS daily_engagement_points INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS region VARCHAR(50) DEFAULT 'Other',
        ADD COLUMN IF NOT EXISTS is_super_tribe BOOLEAN DEFAULT false;
    `);
    console.log('Added tribes scoring columns');

    // 2. Create daily_engagement_streaks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_engagement_streaks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        tribe_id UUID REFERENCES tribes(id) ON DELETE CASCADE,
        streak_date DATE NOT NULL,
        streak_count INTEGER DEFAULT 1,
        engagement_type VARCHAR(30) NOT NULL CHECK (engagement_type IN ('quiz', 'battle', 'prediction', 'daily_login')),
        points_earned INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, tribe_id, streak_date, engagement_type)
      );
    `);
    console.log('Created daily_engagement_streaks table');

    // 3. Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_engagement_streaks_user ON daily_engagement_streaks(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_engagement_streaks_tribe ON daily_engagement_streaks(tribe_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_engagement_streaks_date ON daily_engagement_streaks(streak_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_engagement_streaks_composite ON daily_engagement_streaks(tribe_id, streak_date);`);
    console.log('Created engagement indexes');

    // 4. Seed African Giants tribes (upsert by slug)
    for (const tribe of AFRICAN_GIANTS) {
      // Resolve rival tribe IDs
      const rivalIds = [];
      for (const rivalSlug of tribe.rivalry_slugs) {
        const rivalRes = await client.query(
          'SELECT id FROM tribes WHERE slug = $1',
          [rivalSlug]
        );
        if (rivalRes.rows.length > 0) {
          rivalIds.push(rivalRes.rows[0].id);
        }
      }

      await client.query(`
        INSERT INTO tribes (name, slug, type, primary_color, secondary_color, region, is_super_tribe, rival_tribe_ids)
        VALUES ($1, $2, $3, $4, $5, $6, true, $7)
        ON CONFLICT (slug) DO UPDATE SET
          region = EXCLUDED.region,
          is_super_tribe = true,
          rival_tribe_ids = EXCLUDED.rival_tribe_ids
      `, [tribe.name, tribe.slug, tribe.type, tribe.primary_color, tribe.secondary_color, tribe.region, rivalIds]);

      console.log(`Upserted tribe: ${tribe.name} (${tribe.slug})`);
    }

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
