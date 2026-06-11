import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const REWARDS = [
  { tribe: 'Al Ahly', badge: 'badge_gen_al_ahly', frame: 'frame_imp_al_ahly', name: 'Al Ahly' },
  { tribe: 'Wydad Casablanca', badge: 'badge_gen_wydad', frame: 'frame_imp_wydad', name: 'Wydad' },
  { tribe: 'Raja Casablanca', badge: 'badge_gen_raja', frame: 'frame_imp_raja', name: 'Raja' },
  { tribe: 'Young Africans SC', badge: 'badge_gen_yanga', frame: 'frame_imp_yanga', name: 'Yanga' },
  { tribe: 'Enyimba International FC', badge: 'badge_gen_enyimba', frame: 'frame_imp_enyimba', name: 'Enyimba' },
  { tribe: 'Orlando Pirates', badge: 'badge_gen_pirates', frame: 'frame_imp_pirates', name: 'Pirates' },
  { tribe: 'Simba SC', badge: 'badge_gen_simba', frame: 'frame_imp_simba', name: 'Simba' },
  { tribe: 'Mamelodi Sundowns', badge: 'badge_gen_sundowns', frame: 'frame_imp_sundowns', name: 'Sundowns' },
  { tribe: 'Kaizer Chiefs', badge: 'badge_gen_chiefs', frame: 'frame_imp_chiefs', name: 'Chiefs' },
  { tribe: 'Zamalek SC', badge: 'badge_gen_zamalek', frame: 'frame_imp_zamalek', name: 'Zamalek' }
];

async function seed() {
  console.log('Seeding Imperial Ten Badges and Frames...');
  
  for (const r of REWARDS) {
    // 1. Badge
    await pool.query(
      `INSERT INTO badges (id, slug, name, description, icon, tier, category) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) 
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, tier = EXCLUDED.tier, category = EXCLUDED.category`,
      [r.badge, `Founding General of ${r.name}`, `Legendary badge for Top 50 contributors of ${r.tribe}`, r.badge, 'platinum', 'prestige']
    );

    // 2. Shop Product
    await pool.query(
      `INSERT INTO shop_products (id, name, description, goal_tokens, category, is_active, metadata) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, metadata = EXCLUDED.metadata`,
      [r.frame, `Imperial Frame: ${r.name}`, `Elite animated frame for ${r.tribe} members`, 0, 'prestige_reward', true, JSON.stringify({ tribe_lock: r.tribe, role_lock: 'general', gt_boost: 0.10 })]
    );

    // 3. Collectible
    await pool.query(
      `INSERT INTO collectibles (id, name, description, type, rarity, tribe_restriction, equip_slot) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, tribe_restriction = EXCLUDED.tribe_restriction, type = EXCLUDED.type, rarity = EXCLUDED.rarity`,
      [r.frame, `Imperial Frame: ${r.name}`, `Elite animated frame for ${r.tribe} members`, 'tribe_skin', 'diamond', r.tribe, 'profile_frame']
    );
  }

  console.log('Seeding complete.');
  await pool.end();
}

seed().catch(console.error);
