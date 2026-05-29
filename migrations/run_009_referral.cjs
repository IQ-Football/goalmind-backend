// Referral System Migration — The Recruitment Drive
// Run: node migrations/run_009_referral.cjs

const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ 
  host: 'localhost', 
  port: 5432, 
  database: 'goalmind', 
  user: 'postgres', 
  password: 'postgres' 
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Starting referral system migration...');
    
    // 1. Referrals table — tracks attribution
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id     UUID NOT NULL REFERENCES users(id),
        recruit_id      UUID REFERENCES users(id),
        referral_code   VARCHAR(50) NOT NULL,
        tribe_id        UUID REFERENCES tribes(id),
        source          VARCHAR(20) DEFAULT 'direct' 
                         CHECK (source IN ('whatsapp','instagram','twitter','tiktok','discord','direct','other')),
        status          VARCHAR(20) DEFAULT 'pending'
                         CHECK (status IN ('pending','joined','converted','expired')),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        converted_at    TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
      );
    `);
    console.log('Referrals table OK');
    
    // 2. Add referral columns to users table
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50),
      ADD COLUMN IF NOT EXISTS nation_points INTEGER DEFAULT 0;
    `);
    console.log('User referral columns OK');
    
    // 3. Indexes for referrals
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referrals_recruit ON referrals(recruit_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status)`);
    console.log('Indexes OK');
    
    // 4. Badges table (if not exists) and referral milestone badges
    await client.query(`
      CREATE TABLE IF NOT EXISTS badges (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug            VARCHAR(50) UNIQUE NOT NULL,
        name            VARCHAR(100) NOT NULL,
        description     TEXT,
        icon            VARCHAR(20),
        tier            VARCHAR(20) DEFAULT 'bronze' 
                         CHECK (tier IN ('bronze','silver','gold','platinum')),
        category        VARCHAR(50) DEFAULT 'achievement',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Badges table OK');
    
    // Referral milestone badges
    const badges = [
      { slug: 'recruiter', name: 'Recruiter', description: 'Recruited your first player to your National Tribe', icon: '👥', tier: 'bronze' },
      { slug: 'tribe_general', name: 'Tribe General', description: 'Recruited 10+ players to your nation', icon: '⚔️', tier: 'silver' },
      { slug: 'national_hero', name: 'National Hero', description: 'Recruited 25+ players — top recruiter status', icon: '🏅', tier: 'gold' },
      { slug: 'supreme_commander', name: 'Supreme Commander', description: 'Top recruiter globally — rarest World Cup badge', icon: '👑', tier: 'platinum' },
    ];
    
    for (const badge of badges) {
      await client.query(`
        INSERT INTO badges (slug, name, description, icon, tier, category, created_at)
        VALUES ($1, $2, $3, $4, $5, 'referral', NOW())
        ON CONFLICT (slug) DO NOTHING
      `, [badge.slug, badge.name, badge.description, badge.icon, badge.tier]);
    }
    console.log('Referral badges seeded OK');
    
    // 5. National tribes data (48 nations for the Global Arena)
    const nationalTribes = [
      // Europe
      { name: 'England', slug: 'england', abbr: 'ENG', type: 'national', colors: ['#FFFFFF', '#CF142B'], region: 'Europe', flag_code: 'GB-ENG' },
      { name: 'France', slug: 'france', abbr: 'FRA', type: 'national', colors: ['#002395', '#ED2939'], region: 'Europe', flag_code: 'FR' },
      { name: 'Germany', slug: 'germany', abbr: 'GER', type: 'national', colors: ['#000000', '#DD0000'], region: 'Europe', flag_code: 'DE' },
      { name: 'Spain', slug: 'spain', abbr: 'ESP', type: 'national', colors: ['#AA151B', '#F1BF00'], region: 'Europe', flag_code: 'ES' },
      { name: 'Portugal', slug: 'portugal', abbr: 'POR', type: 'national', colors: ['#006600', '#FF0000'], region: 'Europe', flag_code: 'PT' },
      { name: 'Italy', slug: 'italy', abbr: 'ITA', type: 'national', colors: ['#009246', '#006618'], region: 'Europe', flag_code: 'IT' },
      { name: 'Netherlands', slug: 'netherlands', abbr: 'NED', type: 'national', colors: ['#FF6600', '#FFFFFF'], region: 'Europe', flag_code: 'NL' },
      { name: 'Belgium', slug: 'belgium', abbr: 'BEL', type: 'national', colors: ['#FFCE00', '#000000'], region: 'Europe', flag_code: 'BE' },
      { name: 'Switzerland', slug: 'switzerland', abbr: 'SUI', type: 'national', colors: ['#FF0000', '#FFFFFF'], region: 'Europe', flag_code: 'CH' },
      { name: 'Croatia', slug: 'croatia', abbr: 'CRO', type: 'national', colors: ['#FF0000', '#FFFFFF'], region: 'Europe', flag_code: 'HR' },
      // South America
      { name: 'Argentina', slug: 'argentina', abbr: 'ARG', type: 'national', colors: ['#74ACDF', '#FFFFFF'], region: 'South America', flag_code: 'AR' },
      { name: 'Brazil', slug: 'brazil', abbr: 'BRA', type: 'national', colors: ['#009C3B', '#FFDF00'], region: 'South America', flag_code: 'BR' },
      { name: 'Uruguay', slug: 'uruguay', abbr: 'URU', type: 'national', colors: ['#5CBFEB', '#FFFFFF'], region: 'South America', flag_code: 'UY' },
      { name: 'Colombia', slug: 'colombia', abbr: 'COL', type: 'national', colors: ['#FCD116', '#003893'], region: 'South America', flag_code: 'CO' },
      { name: 'Chile', slug: 'chile', abbr: 'CHI', type: 'national', colors: ['#D52B1E', '#FFFFFF'], region: 'South America', flag_code: 'CL' },
      // North America
      { name: 'USA', slug: 'usa', abbr: 'USA', type: 'national', colors: ['#3C3B6E', '#FFFFFF'], region: 'North America', flag_code: 'US' },
      { name: 'Mexico', slug: 'mexico', abbr: 'MEX', type: 'national', colors: ['#006341', '#CE1126'], region: 'North America', flag_code: 'MX' },
      { name: 'Canada', slug: 'canada', abbr: 'CAN', type: 'national', colors: ['#FF0000', '#FFFFFF'], region: 'North America', flag_code: 'CA' },
      // Africa
      { name: 'Nigeria', slug: 'nigeria', abbr: 'NGA', type: 'national', colors: ['#008751', '#FFFFFF'], region: 'Africa', flag_code: 'NG' },
      { name: 'Senegal', slug: 'senegal', abbr: 'SEN', type: 'national', colors: ['#008800', '#FDEE00'], region: 'Africa', flag_code: 'SN' },
      { name: 'Morocco', slug: 'morocco', abbr: 'MAR', type: 'national', colors: ['#C1272D', '#006233'], region: 'Africa', flag_code: 'MA' },
      { name: 'Egypt', slug: 'egypt', abbr: 'EGY', type: 'national', colors: ['#CE1126', '#FFFFFF'], region: 'Africa', flag_code: 'EG' },
      { name: 'Ghana', slug: 'ghana', abbr: 'GHA', type: 'national', colors: ['#EF0913', '#FCD116'], region: 'Africa', flag_code: 'GH' },
      { name: 'Ivory Coast', slug: 'ivory-coast', abbr: 'CIV', type: 'national', colors: ['#F77F00', '#009A3D'], region: 'Africa', flag_code: 'CI' },
      { name: 'Cameroon', slug: 'cameroon', abbr: 'CAM', type: 'national', colors: ['#007A33', '#CE1126'], region: 'Africa', flag_code: 'CM' },
      { name: 'Algeria', slug: 'algeria', abbr: 'ALG', type: 'national', colors: ['#007A39', '#D21034'], region: 'Africa', flag_code: 'DZ' },
      { name: 'Tunisia', slug: 'tunisia', abbr: 'TUN', type: 'national', colors: ['#E70013', '#FFFFFF'], region: 'Africa', flag_code: 'TN' },
      { name: 'South Africa', slug: 'south-africa', abbr: 'RSA', type: 'national', colors: ['#007A4D', '#FFB612'], region: 'Africa', flag_code: 'ZA' },
      // Asia
      { name: 'Japan', slug: 'japan', abbr: 'JPN', type: 'national', colors: ['#FFFFFF', '#BC002D'], region: 'Asia', flag_code: 'JP' },
      { name: 'South Korea', slug: 'south-korea', abbr: 'KOR', type: 'national', colors: ['#CD2E3A', '#0047A0'], region: 'Asia', flag_code: 'KR' },
      { name: 'Iran', slug: 'iran', abbr: 'IRN', type: 'national', colors: ['#239F40', '#DA0000'], region: 'Asia', flag_code: 'IR' },
      { name: 'Saudi Arabia', slug: 'saudi-arabia', abbr: 'KSA', type: 'national', colors: ['#006C35', '#FFFFFF'], region: 'Asia', flag_code: 'SA' },
      { name: 'Australia', slug: 'australia', abbr: 'AUS', type: 'national', colors: ['#00008B', '#FFFFFF'], region: 'Asia', flag_code: 'AU' },
      { name: 'Qatar', slug: 'qatar', abbr: 'QAT', type: 'national', colors: ['#8A1538', '#FFFFFF'], region: 'Asia', flag_code: 'QA' },
      { name: 'UAE', slug: 'uae', abbr: 'UAE', type: 'national', colors: ['#00732F', '#FF0000'], region: 'Asia', flag_code: 'AE' },
    ];
    
    // Add is_national_tribe column if not exists
    await client.query(`
      ALTER TABLE tribes ADD COLUMN IF NOT EXISTS is_national_tribe BOOLEAN DEFAULT false
    `);
    console.log('is_national_tribe column OK');
    
    // Seed national tribes (type='club' to pass constraint, is_national_tribe=true marks them as national)
    for (const tribe of nationalTribes) {
      await client.query(`
        INSERT INTO tribes (name, slug, type, primary_color, secondary_color, region, is_national_tribe, created_at)
        VALUES ($1, $2, 'club', $3, $4, $5, true, NOW())
        ON CONFLICT (slug) DO UPDATE SET
          primary_color = EXCLUDED.primary_color,
          secondary_color = EXCLUDED.secondary_color,
          region = EXCLUDED.region,
          is_national_tribe = true
      `, [tribe.name, tribe.slug, tribe.colors[0], tribe.colors[1], tribe.region]);
    }
    console.log(`National tribes seeded: ${nationalTribes.length}`);
    
    // 6. National leaderboard view
    await client.query(`
      CREATE OR REPLACE VIEW national_leaderboard AS
      SELECT 
        t.id as tribe_id,
        t.name as tribe_name,
        t.slug as tribe_slug,
        t.region,
        COUNT(u.id) as total_users,
        COALESCE(SUM(u.nation_points), 0) as total_nation_points,
        RANK() OVER (ORDER BY COALESCE(SUM(u.nation_points), 0) DESC) as rank
      FROM tribes t
      LEFT JOIN users u ON u.tribe_id = t.id
      WHERE t.is_national_tribe = true
      GROUP BY t.id, t.name, t.slug, t.region
      ORDER BY total_nation_points DESC;
    `);
    console.log('National leaderboard view OK');
    
    console.log('\n=== Referral system migration complete ===');
    console.log('Tables: referrals');
    console.log('User columns: referral_count, referred_by, referral_code, nation_points');
    console.log('Badges: recruiter, tribe_general, national_hero, supreme_commander');
    console.log('Tribes: ' + nationalTribes.length + ' national tribes seeded');
    
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