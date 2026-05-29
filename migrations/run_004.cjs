// Run collectibles migration
const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function migrate() {
  const client = await pool.connect();
  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS collectibles (
        id                  VARCHAR(100) PRIMARY KEY,
        name                VARCHAR(255) NOT NULL,
        description         TEXT,
        type                VARCHAR(50) NOT NULL CHECK (type IN ('moment_card', 'ultra_banner', 'tribe_skin')),
        rarity              VARCHAR(20) NOT NULL CHECK (rarity IN ('bronze', 'silver', 'gold', 'diamond')),
        image_url           TEXT,
        achievement_trigger VARCHAR(100),
        tribe_restriction   VARCHAR(100),
        equip_slot          VARCHAR(50),
        skin_tier           INTEGER DEFAULT NULL,
        created_at          TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_collectibles (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        collectible_id VARCHAR(100) NOT NULL REFERENCES collectibles(id) ON DELETE CASCADE,
        acquired_at    TIMESTAMPTZ DEFAULT NOW(),
        equipped       BOOLEAN DEFAULT FALSE,
        UNIQUE (user_id, collectible_id)
      );
    `);
    console.log('Tables created OK');

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_collectibles_user_id ON user_collectibles(user_id);
      CREATE INDEX IF NOT EXISTS idx_collectibles_type ON collectibles(type);
    `);
    console.log('Indexes created OK');

    // Seed collectibles (using parameterized inserts)
    const seedItems = [
      // Moment Cards
      ['card_istanbul_2005', 'The Miracle of Istanbul', 'Liverpool vs AC Milan — The greatest comeback in Champions League history.', 'moment_card', 'gold', '/assets/collectibles/moments/istanbul_2005.png', 'scenario_istanbul_2005_complete', null, null, null],
      ['card_treble_1999', 'The 1999 Treble', "Manchester United's historic Champions League Final comeback.", 'moment_card', 'gold', '/assets/collectibles/moments/treble_1999.png', 'scenario_trebble_1999_complete', null, null, null],
      ['card_worldcup_2022', "The GOAT's Coronation", "Argentina vs France 2022 — Messi's crowning glory.", 'moment_card', 'diamond', '/assets/collectibles/moments/worldcup_2022.png', 'scenario_worldcup_2022_complete', null, null, null],
      ['card_invincibles_2004', 'The Invincibles', "Arsenal's unbeaten Premier League season 2003/04.", 'moment_card', 'silver', '/assets/collectibles/moments/invincibles_2004.png', 'scenario_invincibles_2004_complete', null, null, null],
      ['card_leicester_2016', "Leicester's Miracle", "The 5000/1 Premier League title — football's greatest upset.", 'moment_card', 'gold', '/assets/collectibles/moments/leicester_2016.png', 'scenario_leicester_2016_complete', null, null, null],
      ['card_first_victory', 'First Blood', 'Win your first 1v1 Blitz battle.', 'moment_card', 'bronze', '/assets/collectibles/moments/first_victory.png', 'first_battle_win', null, null, null],
      ['card_streak_5', 'On Fire', 'Win 5 battles in a row.', 'moment_card', 'silver', '/assets/collectibles/moments/streak_5.png', 'battle_streak_5', null, null, null],
      ['card_world_class', 'World Class', 'Reach the World Class rank.', 'moment_card', 'gold', '/assets/collectibles/moments/world_class.png', 'reach_world_class', null, null, null],
      // Ultra Banners
      ['banner_real_madrid', 'Real Madrid Ultra', 'White and gold gradient with aggressive tribal textures.', 'ultra_banner', 'gold', '/assets/collectibles/banners/real_madrid_ultra.png', null, 'real-madrid', 'banner', null],
      ['banner_barcelona', 'Barcelona Ultra', 'Blaugrana pride — deep blue and garnet gradient.', 'ultra_banner', 'gold', '/assets/collectibles/banners/barcelona_ultra.png', null, 'barcelona', 'banner', null],
      ['banner_liverpool', 'Liverpool Ultra', 'Anfield fire — deep red with tribal amber accents.', 'ultra_banner', 'gold', '/assets/collectibles/banners/liverpool_ultra.png', null, 'liverpool', 'banner', null],
      ['banner_manchester_united', 'Manchester United Ultra', 'Devil red — devil horns iconography and silver trim.', 'ultra_banner', 'gold', '/assets/collectibles/banners/manchester_united_ultra.png', null, 'manchester-united', 'banner', null],
      ['banner_chelsea', 'Chelsea Ultra', 'Royal blue — Kings of London gradient.', 'ultra_banner', 'gold', '/assets/collectibles/banners/chelsea_ultra.png', null, 'chelsea', 'banner', null],
      ['banner_arsenal', 'Arsenal Ultra', 'Gunners navy — cannon badge with red accents.', 'ultra_banner', 'gold', '/assets/collectibles/banners/arsenal_ultra.png', null, 'arsenal', 'banner', null],
      ['banner_bayern_munich', 'Bayern Munich Ultra', 'German precision — red and white with diamond patterns.', 'ultra_banner', 'gold', '/assets/collectibles/banners/bayern_munich_ultra.png', null, 'bayern-munich', 'banner', null],
      ['banner_champions_league', 'Champions League Legend', 'Starball and trophy iconography — the ultimate football achievement.', 'ultra_banner', 'diamond', '/assets/collectibles/banners/ucl_legend.png', 'ucl_legend_badge', null, 'banner', null],
      // Tribe Skins
      ['skin_supporter', 'Supporter Skin', 'Bronze border, minimalist tribal badge. Entry-level prestige.', 'tribe_skin', 'bronze', '/assets/collectibles/skins/supporter_skin.png', null, null, 'skin', 1],
      ['skin_ultra', 'Ultra Skin', 'Silver border, tribal flair added, glassmorphism enhancements.', 'tribe_skin', 'silver', '/assets/collectibles/skins/ultra_skin.png', 'identity_tier_ultra', null, 'skin', 2],
      ['skin_legend', 'Legend Skin', 'Gold border, glowing animated badge, breathing neon borders.', 'tribe_skin', 'gold', '/assets/collectibles/skins/legend_skin.png', 'identity_tier_legend', null, 'skin', 3],
      ['skin_goat', 'GOAT Skin', "Diamond/iridescent — crown icon, constant neon pulse. Ultimate status.", 'tribe_skin', 'diamond', '/assets/collectibles/skins/goat_skin.png', 'identity_tier_goat', null, 'skin', 4],
    ];

    for (const item of seedItems) {
      await client.query(
        `INSERT INTO collectibles (id, name, description, type, rarity, image_url, achievement_trigger, tribe_restriction, equip_slot, skin_tier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        item
      );
    }
    console.log(`Seeded ${seedItems.length} collectibles`);

    // Verify
    const { rows } = await client.query('SELECT COUNT(*) FROM collectibles');
    console.log(`Total collectibles in DB: ${rows[0].count}`);

  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
