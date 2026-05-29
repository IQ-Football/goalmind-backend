import { v4 as uuidv4 } from 'uuid';

/**
 * Collectibles Service
 * 
 * Manages Historical Moment Cards, Ultra Banners, and Tribe Skins.
 * Handles ownership, equipping, and achievement-triggered rewards.
 */

// Collectible catalog: all available items in the game
const COLLECTIBLES_CATALOG = [
  // ===== HISTORICAL MOMENT CARDS (Bronze → Diamond rarity) =====
  {
    id: 'card_istanbul_2005',
    name: 'The Miracle of Istanbul',
    description: 'Liverpool vs AC Milan — The greatest comeback in Champions League history.',
    type: 'moment_card',
    rarity: 'gold',        // bronze / silver / gold / diamond
    image_url: '/assets/collectibles/moments/istanbul_2005.png',
    achievement_trigger: 'scenario_istanbul_2005_complete',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_treble_1999',
    name: 'The 1999 Treble',
    description: 'Manchester United\'s historic Champions League Final comeback.',
    type: 'moment_card',
    rarity: 'gold',
    image_url: '/assets/collectibles/moments/treble_1999.png',
    achievement_trigger: 'scenario_trebble_1999_complete',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_worldcup_2022',
    name: 'The GOAT\'s Coronation',
    description: 'Argentina vs France 2022 — Messi\'s crowning glory.',
    type: 'moment_card',
    rarity: 'diamond',
    image_url: '/assets/collectibles/moments/worldcup_2022.png',
    achievement_trigger: 'scenario_worldcup_2022_complete',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_invincibles_2004',
    name: 'The Invincibles',
    description: 'Arsenal\'s unbeaten Premier League season 2003/04.',
    type: 'moment_card',
    rarity: 'silver',
    image_url: '/assets/collectibles/moments/invincibles_2004.png',
    achievement_trigger: 'scenario_invincibles_2004_complete',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_leicester_2016',
    name: 'Leicester\'s Miracle',
    description: 'The 5000/1 Premier League title — football\'s greatest upset.',
    type: 'moment_card',
    rarity: 'gold',
    image_url: '/assets/collectibles/moments/leicester_2016.png',
    achievement_trigger: 'scenario_leicester_2016_complete',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_first_victory',
    name: 'First Blood',
    description: 'Win your first 1v1 Blitz battle.',
    type: 'moment_card',
    rarity: 'bronze',
    image_url: '/assets/collectibles/moments/first_victory.png',
    achievement_trigger: 'first_battle_win',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_streak_5',
    name: 'On Fire',
    description: 'Win 5 battles in a row.',
    type: 'moment_card',
    rarity: 'silver',
    image_url: '/assets/collectibles/moments/streak_5.png',
    achievement_trigger: 'battle_streak_5',
    tribe_restriction: null,
    equip_slot: null,
  },
  {
    id: 'card_world_class',
    name: 'World Class',
    description: 'Reach the World Class rank.',
    type: 'moment_card',
    rarity: 'gold',
    image_url: '/assets/collectibles/moments/world_class.png',
    achievement_trigger: 'reach_world_class',
    tribe_restriction: null,
    equip_slot: null,
  },

  // ===== ULTRA BANNERS (Profile backgrounds) =====
  {
    id: 'banner_real_madrid',
    name: 'Real Madrid Ultra',
    description: 'White and gold gradient with aggressive tribal textures.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/real_madrid_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'real-madrid',
    equip_slot: 'banner',
  },
  {
    id: 'banner_barcelona',
    name: 'Barcelona Ultra',
    description: 'Blaugrana pride — deep blue and garnet gradient.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/barcelona_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'barcelona',
    equip_slot: 'banner',
  },
  {
    id: 'banner_liverpool',
    name: 'Liverpool Ultra',
    description: 'Anfield fire — deep red with tribal amber accents.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/liverpool_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'liverpool',
    equip_slot: 'banner',
  },
  {
    id: 'banner_manchester_united',
    name: 'Manchester United Ultra',
    description: 'Devil red — devil horns iconography and silver trim.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/manchester_united_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'manchester-united',
    equip_slot: 'banner',
  },
  {
    id: 'banner_chelsea',
    name: 'Chelsea Ultra',
    description: 'Royal blue — Kings of London gradient.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/chelsea_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'chelsea',
    equip_slot: 'banner',
  },
  {
    id: 'banner_arsenal',
    name: 'Arsenal Ultra',
    description: 'Gunners navy — cannon badge with red accents.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/arsenal_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'arsenal',
    equip_slot: 'banner',
  },
  {
    id: 'banner_bayern_munich',
    name: 'Bayern Munich Ultra',
    description: 'German precision — red and white with diamond patterns.',
    type: 'ultra_banner',
    rarity: 'gold',
    image_url: '/assets/collectibles/banners/bayern_munich_ultra.png',
    achievement_trigger: null,
    tribe_restriction: 'bayern-munich',
    equip_slot: 'banner',
  },
  {
    id: 'banner_champions_league',
    name: 'Champions League Legend',
    description: 'Starball and trophy iconography — the ultimate football achievement.',
    type: 'ultra_banner',
    rarity: 'diamond',
    image_url: '/assets/collectibles/banners/ucl_legend.png',
    achievement_trigger: 'ucl_legend_badge',
    tribe_restriction: null,
    equip_slot: 'banner',
  },

  // ===== TRIBE SKINS (UI themes) =====
  {
    id: 'skin_supporter',
    name: 'Supporter Skin',
    description: 'Bronze border, minimalist tribal badge. Entry-level prestige.',
    type: 'tribe_skin',
    rarity: 'bronze',
    image_url: '/assets/collectibles/skins/supporter_skin.png',
    achievement_trigger: null,
    tribe_restriction: null,
    equip_slot: 'skin',
    skin_tier: 1,
  },
  {
    id: 'skin_ultra',
    name: 'Ultra Skin',
    description: 'Silver border, tribal flair added, glassmorphism enhancements.',
    type: 'tribe_skin',
    rarity: 'silver',
    image_url: '/assets/collectibles/skins/ultra_skin.png',
    achievement_trigger: 'identity_tier_ultra',
    tribe_restriction: null,
    equip_slot: 'skin',
    skin_tier: 2,
  },
  {
    id: 'skin_legend',
    name: 'Legend Skin',
    description: 'Gold border, glowing animated badge, breathing neon borders.',
    type: 'tribe_skin',
    rarity: 'gold',
    image_url: '/assets/collectibles/skins/legend_skin.png',
    achievement_trigger: 'identity_tier_legend',
    tribe_restriction: null,
    equip_slot: 'skin',
    skin_tier: 3,
  },
  {
    id: 'skin_goat',
    name: 'GOAT Skin',
    description: 'Diamond/iridescent — crown icon, constant neon pulse. Ultimate status.',
    type: 'tribe_skin',
    rarity: 'diamond',
    image_url: '/assets/collectibles/skins/goat_skin.png',
    achievement_trigger: 'identity_tier_goat',
    tribe_restriction: null,
    equip_slot: 'skin',
    skin_tier: 4,
  },
];

/**
 * Get the full collectibles catalog (for shop/gallery display)
 */
export function getCollectiblesCatalog() {
  return COLLECTIBLES_CATALOG.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    type: c.type,
    rarity: c.rarity,
    image_url: c.image_url,
    tribe_restriction: c.tribe_restriction,
  }));
}

/**
 * Get a specific collectible by ID
 */
export function getCollectibleById(id) {
  return COLLECTIBLES_CATALOG.find(c => c.id === id) || null;
}

/**
 * Get collectibles by type
 */
export function getCollectiblesByType(type) {
  return COLLECTIBLES_CATALOG.filter(c => c.type === type).map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    rarity: c.rarity,
    image_url: c.image_url,
  }));
}

/**
 * Get user's owned collectibles
 */
export async function getUserCollectibles(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT uc.collectible_id, uc.acquired_at, uc.equipped,
              c.name, c.description, c.type, c.rarity, c.image_url, c.tribe_restriction
       FROM user_collectibles uc
       JOIN collectibles c ON c.id = uc.collectible_id
       WHERE uc.user_id = $1
       ORDER BY uc.acquired_at DESC`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    fastify.log.error('Error fetching user collectibles:', err);
    return [];
  }
}

/**
 * Get user's equipped items
 */
export async function getUserEquipped(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT uc.collectible_id, c.type, c.name, c.image_url
       FROM user_collectibles uc
       JOIN collectibles c ON c.id = uc.collectible_id
       WHERE uc.user_id = $1 AND uc.equipped = true`,
      [userId]
    );
    
    const equipped = {};
    for (const row of result.rows) {
      equipped[row.type] = {
        collectible_id: row.collectible_id,
        name: row.name,
        image_url: row.image_url,
      };
    }
    return equipped;
  } catch (err) {
    fastify.log.error('Error fetching equipped items:', err);
    return {};
  }
}

/**
 * Grant a collectible to a user (used by achievement triggers)
 */
export async function grantCollectible(fastify, userId, collectibleId) {
  try {
    // Check if already owned
    const existing = await fastify.db.query(
      `SELECT id FROM user_collectibles WHERE user_id = $1 AND collectible_id = $2`,
      [userId, collectibleId]
    );
    
    if (existing.rows.length > 0) {
      return { success: false, reason: 'already_owned' };
    }

    await fastify.db.query(
      `INSERT INTO user_collectibles (id, user_id, collectible_id, acquired_at, equipped)
       VALUES ($1, $2, $3, NOW(), false)`,
      [uuidv4(), userId, collectibleId]
    );

    return { success: true };
  } catch (err) {
    fastify.log.error('Error granting collectible:', err);
    return { success: false, reason: 'db_error' };
  }
}

/**
 * Equip a collectible (banner or skin)
 */
export async function equipCollectible(fastify, userId, collectibleId) {
  try {
    const collectible = getCollectibleById(collectibleId);
    if (!collectible) {
      return { success: false, reason: 'not_found' };
    }

    if (!collectible.equip_slot) {
      return { success: false, reason: 'not_equippable' };
    }

    // Verify user owns this collectible
    const owned = await fastify.db.query(
      `SELECT id FROM user_collectibles WHERE user_id = $1 AND collectible_id = $2`,
      [userId, collectibleId]
    );

    if (owned.rows.length === 0) {
      return { success: false, reason: 'not_owned' };
    }

    // Unequip any currently equipped item of the same type
    await fastify.db.query(
      `UPDATE user_collectibles SET equipped = false
       WHERE user_id = $1 AND collectible_id IN (
         SELECT id FROM collectibles WHERE type = $2
       )`,
      [userId, collectible.type]
    );

    // Equip the selected item
    await fastify.db.query(
      `UPDATE user_collectibles SET equipped = true WHERE user_id = $1 AND collectible_id = $2`,
      [userId, collectibleId]
    );

    return { success: true };
  } catch (err) {
    fastify.log.error('Error equipping collectible:', err);
    return { success: false, reason: 'db_error' };
  }
}

/**
 * Unequip a collectible
 */
export async function unequipCollectible(fastify, userId, collectibleId) {
  try {
    await fastify.db.query(
      `UPDATE user_collectibles SET equipped = false
       WHERE user_id = $1 AND collectible_id = $2`,
      [userId, collectibleId]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error('Error unequipping collectible:', err);
    return { success: false, reason: 'db_error' };
  }
}

/**
 * Check if an achievement unlock should grant a collectible
 * Called by the achievement service when a badge is awarded.
 */
export async function checkAndGrantCollectibleForAchievement(fastify, userId, achievementId) {
  const collectible = COLLECTIBLES_CATALOG.find(c => c.achievement_trigger === achievementId);
  if (!collectible) return null;

  const result = await grantCollectible(fastify, userId, collectible.id);
  if (result.success) {
    return collectible;
  }
  return null;
}

/**
 * Mock: Claim a collectible for testing (bypasses achievement trigger)
 */
export async function claimCollectibleMock(fastify, userId, collectibleId) {
  const collectible = getCollectibleById(collectibleId);
  if (!collectible) {
    return { success: false, reason: 'not_found' };
  }

  const result = await grantCollectible(fastify, userId, collectibleId);
  if (result.success) {
    return { success: true, collectible };
  }
  return result;
}

export default {
  getCollectiblesCatalog,
  getCollectibleById,
  getCollectiblesByType,
  getUserCollectibles,
  getUserEquipped,
  grantCollectible,
  equipCollectible,
  unequipCollectible,
  checkAndGrantCollectibleForAchievement,
  claimCollectibleMock,
};
