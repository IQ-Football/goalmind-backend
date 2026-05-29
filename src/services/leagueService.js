import config from '../config.js';

// League tier names (from PRD)
export const LEAGUE_NAMES = [
  'Sunday League',      // Tier 1
  'Regional',           // Tier 2
  'National',           // Tier 3
  'Continental',        // Tier 4
  'World Class',        // Tier 5
  'GOAT'                // Tier 6
];

// Elo ranges for each league tier
export const LEAGUE_ELO_RANGES = [
  { min: 0, max: 1100 },      // Sunday League: 0-1100
  { min: 1100, max: 1200 },   // Regional: 1100-1200
  { min: 1200, max: 1300 },   // National: 1200-1300
  { min: 1300, max: 1450 },   // Continental: 1300-1450
  { min: 1450, max: 1600 },   // World Class: 1450-1600
  { min: 1600, max: 9999 },   // GOAT: 1600+
];

export function getLeagueNameForElo(elo) {
  for (const range of LEAGUE_ELO_RANGES) {
    if (elo >= range.min && elo < range.max) {
      return LEAGUE_NAMES[LEAGUE_ELO_RANGES.indexOf(range)];
    }
  }
  return LEAGUE_NAMES[LEAGUE_NAMES.length - 1]; // GOAT
}

export function getLeagueTierForElo(elo) {
  for (let i = 0; i < LEAGUE_ELO_RANGES.length; i++) {
    if (elo >= LEAGUE_ELO_RANGES[i].min && elo < LEAGUE_ELO_RANGES[i].max) {
      return i + 1;
    }
  }
  return LEAGUE_ELO_RANGES.length; // 6 for GOAT
}

// Update user's league standing after a battle
export async function updateLeagueStandings(userId, newElo, fastify) {
  try {
    // Find user's current active league participation
    const participantResult = await fastify.db.query(
      `SELECT lp.*, l.tier, l.min_elo, l.max_elo
       FROM league_participants lp
       JOIN leagues l ON lp.league_id = l.id
       WHERE lp.user_id = $1 AND l.is_active = true
       ORDER BY lp.last_updated_at DESC
       LIMIT 1`,
      [userId]
    );

    if (participantResult.rows.length === 0) {
      return null; // User not in any active league
    }

    const participant = participantResult.rows[0];
    const currentTier = participant.tier;
    const newTier = getLeagueTierForElo(newElo);

    // Update current Elo in league
    await fastify.db.query(
      `UPDATE league_participants 
       SET current_elo = $1, last_updated_at = NOW()
       WHERE user_id = $2 AND league_id = $3`,
      [newElo, userId, participant.league_id]
    );

    // If tier changed significantly, check for auto-promotion/relegation
    if (newTier < currentTier && newTier >= 1) {
      // User has improved - check if they qualify for promotion
      
      // Get current league ranking
      const rankResult = await fastify.db.query(
        `SELECT rank FROM league_participants 
         WHERE league_id = $1 AND current_elo <= $2
         ORDER BY current_elo DESC`,
        [participant.league_id, newElo]
      );

      if (rankResult.rows.length > 0) {
        const newRank = rankResult.rows[0].rank;
        const totalResult = await fastify.db.query(
          'SELECT COUNT(*) FROM league_participants WHERE league_id = $1',
          [participant.league_id]
        );
        const total = parseInt(totalResult.rows[0].count);
        const topPercent = (newRank / total) * 100;

        // Top 10% qualifies for promotion
        if (topPercent <= 10) {
          return {
            userId,
            currentLeague: participant.league_id,
            eligibleForPromotion: true,
            newRank,
            totalParticipants: total,
          };
        }
      }
    }

    return null;
  } catch (err) {
    fastify.log.error(err);
    return null;
  }
}

// Process end of season - promotions and relegations
export async function processSeasonEnd(leagueId, fastify) {
  try {
    const leagueResult = await fastify.db.query(
      'SELECT * FROM leagues WHERE id = $1',
      [leagueId]
    );

    if (leagueResult.rows.length === 0) {
      throw new Error('League not found');
    }

    const league = leagueResult.rows[0];
    const participantsResult = await fastify.db.query(
      `SELECT lp.*, u.elo, u.tribe_id 
       FROM league_participants lp
       JOIN users u ON lp.user_id = u.id
       WHERE lp.league_id = $1
       ORDER BY lp.current_elo DESC`,
      [leagueId]
    );

    const participants = participantsResult.rows;
    const totalCount = participants.length;

    if (totalCount === 0) {
      return { promoted: [], relegated: [], unchanged: [] };
    }

    // Calculate thresholds
    const promotionThreshold = Math.ceil(totalCount * (league.promotion_threshold_percent / 100));
    const relegationThreshold = Math.floor(totalCount * (1 - league.relegation_threshold_percent / 100));

    // Get adjacent leagues
    const higherLeagueResult = await fastify.db.query(
      'SELECT id, name, tier FROM leagues WHERE tier = $1 AND is_active = true ORDER BY tier ASC LIMIT 1',
      [league.tier + 1]
    );
    const lowerLeagueResult = await fastify.db.query(
      'SELECT id, name, tier FROM leagues WHERE tier = $1 AND is_active = true ORDER BY tier DESC LIMIT 1',
      [league.tier - 1]
    );

    const higherLeague = higherLeagueResult.rows[0] || null;
    const lowerLeague = lowerLeagueResult.rows[0] || null;

    const result = {
      promoted: [],
      relegated: [],
      unchanged: [],
    };

    // Process each participant
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const newRank = i + 1;
      const participantData = {
        userId: p.user_id,
        username: null, // Will be filled
        previousRank: p.rank,
        newRank,
        currentElo: p.current_elo,
        tier: league.tier,
      };

      // Update rank in database
      await fastify.db.query(
        `UPDATE league_participants 
         SET rank = $1, last_updated_at = NOW()
         WHERE id = $2`,
        [newRank, p.id]
      );

      if (newRank <= promotionThreshold && higherLeague) {
        // Promote to higher league
        await fastify.db.query(
          `INSERT INTO league_participants 
           (user_id, league_id, elo_at_season_start, current_elo, battles_played, battles_won, rank, is_promoted)
           VALUES ($1, $2, $3, $4, 0, 0, 0, true)
           ON CONFLICT (user_id, league_id) DO UPDATE
           SET elo_at_season_start = $3, current_elo = $4, is_promoted = true, last_updated_at = NOW()`,
          [p.user_id, higherLeague.id, p.current_elo, p.current_elo]
        );
        participantData.newLeague = higherLeague;
        result.promoted.push(participantData);
      } else if (newRank > relegationThreshold && lowerLeague) {
        // Relegate to lower league
        await fastify.db.query(
          `INSERT INTO league_participants 
           (user_id, league_id, elo_at_season_start, current_elo, battles_played, battles_won, rank, is_relegated)
           VALUES ($1, $2, $3, $4, 0, 0, 0, true)
           ON CONFLICT (user_id, league_id) DO UPDATE
           SET elo_at_season_start = $3, current_elo = $4, is_relegated = true, last_updated_at = NOW()`,
          [p.user_id, lowerLeague.id, p.current_elo, p.current_elo]
        );
        participantData.newLeague = lowerLeague;
        result.relegated.push(participantData);
      } else {
        result.unchanged.push(participantData);
      }
    }

    return result;
  } catch (err) {
    fastify.log.error(err);
    throw err;
  }
}

// Seed initial leagues
export async function seedLeagues(fastify) {
  const existingLeagues = await fastify.db.query('SELECT COUNT(*) FROM leagues');
  
  if (parseInt(existingLeagues.rows[0].count) > 0) {
    fastify.log.info('Leagues already seeded');
    return;
  }

  const leagues = [
    { name: 'Sunday League', tier: 1, slug: 'sunday-league', min_elo: 0, max_elo: 1100 },
    { name: 'Regional', tier: 2, slug: 'regional', min_elo: 1100, max_elo: 1200 },
    { name: 'National', tier: 3, slug: 'national', min_elo: 1200, max_elo: 1300 },
    { name: 'Continental', tier: 4, slug: 'continental', min_elo: 1300, max_elo: 1450 },
    { name: 'World Class', tier: 5, slug: 'world-class', min_elo: 1450, max_elo: 1600 },
    { name: 'GOAT', tier: 6, slug: 'goat', min_elo: 1600, max_elo: 9999 },
  ];

  for (const league of leagues) {
    await fastify.db.query(
      `INSERT INTO leagues (name, tier, slug, min_elo, max_elo, season_number, is_active)
       VALUES ($1, $2, $3, $4, $5, 1, true)`,
      [league.name, league.tier, league.slug, league.min_elo, league.max_elo]
    );
  }

  fastify.log.info(`Seeded ${leagues.length} leagues`);
}

export default {
  LEAGUE_NAMES,
  LEAGUE_ELO_RANGES,
  getLeagueNameForElo,
  getLeagueTierForElo,
  updateLeagueStandings,
  processSeasonEnd,
  seedLeagues,
};
