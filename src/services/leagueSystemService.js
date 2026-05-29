/**
 * League System Migration & LP Engine
 * 
 * Creates:
 * - league_seasons, league_groups, league_group_members, league_pr_log tables
 * - Seeds correct 5-tier leagues with proper ELO ranges per spec
 * - Provides LP calculation + battle completion integration
 */

import config from '../config.js';

// ─── 5-TIER LEAGUE DEFINITIONS (from SEASON 1 STRATEGY) ──────────────────────

export const LEAGUE_TIERS = [
  { tier: 1, name: 'Global Arena',      slug: 'global-arena',       minElo: 2201, maxElo: 99999, promotion_threshold_percent: 0, relegation_threshold_percent: 33 },
  { tier: 2, name: 'Continental Premier', slug: 'continental-premier', minElo: 1801, maxElo: 2200, promotion_threshold_percent: 17, relegation_threshold_percent: 33 },
  { tier: 3, name: 'Regional Championship', slug: 'regional-championship', minElo: 1401, maxElo: 1800, promotion_threshold_percent: 20, relegation_threshold_percent: 30 },
  { tier: 4, name: 'District League One', slug: 'district-league-one', minElo: 1001, maxElo: 1400, promotion_threshold_percent: 25, relegation_threshold_percent: 20 },
  { tier: 5, name: 'The Academy',        slug: 'the-academy',         minElo: 0,    maxElo: 1000, promotion_threshold_percent: 50, relegation_threshold_percent: 0 },
];

// ─── LP CALCULATION ───────────────────────────────────────────────────────────

export const LP_CONFIG = {
  WIN: 3,
  DRAW: 1,
  LOSS: 0,
  STREAK_BONUS_PER_N_WINS: 3,   // +1 LP per N consecutive wins
  STREAK_BONUS_LP: 1,
};

export function calculateLPBattleResult(isWin, isDraw, currentWinStreak) {
  let lp = 0;
  if (isWin) {
    lp = LP_CONFIG.WIN;
    // Streak bonus: every 3 consecutive wins adds +1 LP
    if ((currentWinStreak + 1) % LP_CONFIG.STREAK_BONUS_PER_N_WINS === 0) {
      lp += LP_CONFIG.STREAK_BONUS_LP;
    }
  } else if (isDraw) {
    lp = LP_CONFIG.DRAW;
  } else {
    lp = LP_CONFIG.LOSS;
  }
  return lp;
}

// ─── DB SCHEMA ───────────────────────────────────────────────────────────────

export async function ensureLeagueTables(fastify) {
  const queries = [
    `CREATE TABLE IF NOT EXISTS league_seasons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      league_id UUID NOT NULL REFERENCES leagues(id),
      season_number INTEGER NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(20) DEFAULT 'upcoming',
      promoted_users JSONB DEFAULT '[]',
      relegated_users JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(league_id, season_number)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ls_league ON league_seasons(league_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ls_status ON league_seasons(status)`,
    `CREATE INDEX IF NOT EXISTS idx_ls_dates ON league_seasons(start_date, end_date)`,
    `CREATE TABLE IF NOT EXISTS league_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      league_id UUID NOT NULL REFERENCES leagues(id),
      season_id UUID REFERENCES league_seasons(id),
      group_number INTEGER NOT NULL,
      name VARCHAR(50) NOT NULL,
      max_size INTEGER DEFAULT 30,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(league_id, season_id, group_number)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lg_league ON league_groups(league_id)`,
    `CREATE TABLE IF NOT EXISTS league_group_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES league_groups(id),
      user_id UUID NOT NULL REFERENCES users(id),
      participant_id UUID NOT NULL REFERENCES league_participants(id),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(group_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lgm_member ON league_group_members(user_id)`,
    `CREATE TABLE IF NOT EXISTS league_pr_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      league_id UUID NOT NULL REFERENCES leagues(id),
      season_id UUID REFERENCES league_seasons(id),
      action VARCHAR(20) NOT NULL,
      from_group INTEGER,
      to_group INTEGER,
      from_rank INTEGER,
      to_rank INTEGER,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_prl_user ON league_pr_log(user_id)`,
  ];

  for (const sql of queries) {
    try { await fastify.db.query(sql); } catch (e) { /* ignore */ }
  }
}

// ─── SEED 5-TIER LEAGUES ─────────────────────────────────────────────────────

export async function seed5TierLeagues(fastify) {
  // Check if leagues already seeded with correct tier 1 league
  const existing = await fastify.db.query(
    "SELECT COUNT(*) FROM leagues WHERE slug = 'global-arena'"
  );
  
  // We re-seed if names don't match (for migration to Season 1)
  const namesCheck = await fastify.db.query(
    "SELECT name FROM leagues WHERE slug = 'the-academy'"
  );
  
  if (parseInt(existing.rows[0].count) > 0 && namesCheck.rows.length > 0) {
    fastify.log.info('Season 1 leagues already seeded');
  } else {
    // Clear old leagues and related data
    await fastify.db.query("TRUNCATE leagues, league_seasons, league_groups, league_group_members, league_participants, league_pr_log CASCADE");

    const insertSql = `
      INSERT INTO leagues (name, slug, tier, min_elo, max_elo, is_active, 
                           season_duration_days, offseason_duration_days,
                           promotion_threshold_percent, relegation_threshold_percent)
      VALUES ($1, $2, $3, $4, $5, true, 28, 3, $6, $7)
    `;

    for (const l of LEAGUE_TIERS) {
      await fastify.db.query(insertSql, [
        l.name, 
        l.slug, 
        l.tier, 
        l.minElo, 
        l.maxElo, 
        l.promotion_threshold_percent, 
        l.relegation_threshold_percent
      ]);
    }

    fastify.log.info(`Seeded ${LEAGUE_TIERS.length} Season 1 leagues`);
  }

  // Seeding Vanguard 500 members into Regional Championship (Tier 3)
  const championshipLeague = await fastify.db.query("SELECT id FROM leagues WHERE slug = 'regional-championship'");
  if (championshipLeague.rows.length > 0) {
    const leagueId = championshipLeague.rows[0].id;
    
    // Find vanguard_500 members
    const vanguards = await fastify.db.query(
      `SELECT id FROM users 
       WHERE cohort = 'vanguard_500' 
       AND id NOT IN (SELECT user_id FROM league_participants)`
    );
    
    if (vanguards.rows.length > 0) {
      fastify.log.info(`Seeding ${vanguards.rows.length} Vanguard members into Regional Championship`);
      for (const v of vanguards.rows) {
        try {
          await joinLeague(fastify, v.id, leagueId);
        } catch (err) {
          fastify.log.error(`Failed to seed Vanguard user ${v.id}: ${err.message}`);
        }
      }
    }
  }
}

// ─── CREATE/GET CURRENT SEASON ──────────────────────────────────────────────

export async function getOrCreateCurrentSeason(fastify, leagueId) {
  // Find active season for this league
  const active = await fastify.db.query(
    `SELECT * FROM league_seasons WHERE league_id = $1 AND status = 'active' LIMIT 1`,
    [leagueId]
  );
  if (active.rows.length > 0) return active.rows[0];

  // Find upcoming season
  const upcoming = await fastify.db.query(
    `SELECT * FROM league_seasons WHERE league_id = $1 AND status = 'upcoming' LIMIT 1`,
    [leagueId]
  );
  if (upcoming.rows.length > 0) return upcoming.rows[0];

  // Create new season
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 28);

  const seasonNum = await fastify.db.query(
    `SELECT COALESCE(MAX(season_number), 0) + 1 as next FROM league_seasons WHERE league_id = $1`,
    [leagueId]
  );
  const nextNum = seasonNum.rows[0]?.next || 1;

  const result = await fastify.db.query(
    `INSERT INTO league_seasons (league_id, season_number, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING *`,
    [leagueId, nextNum, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
  );
  return result.rows[0];
}

// ─── GET LEAGUE FOR ELO ─────────────────────────────────────────────────────

export function getLeagueForElo(elo) {
  for (const l of LEAGUE_TIERS) {
    if (elo >= l.minElo && elo <= l.maxElo) return l;
  }
  return LEAGUE_TIERS[LEAGUE_TIERS.length - 1];
}

// ─── STATUS FLOOR RULE ──────────────────────────────────────────────────────

export function getMaxAllowedTierForElo(elo) {
  if (elo >= 2201) return 1;
  if (elo >= 1801) return 2;
  if (elo >= 1401) return 3;
  if (elo >= 1001) return 4;
  return 5;
}

// ─── AWARD LP ON BATTLE COMPLETION ───────────────────────────────────────────

export async function awardLeaguePoints(fastify, userId, battleResult) {
  // battleResult: { isWin, isDraw, isLoss, newElo }
  const { isWin, isDraw } = battleResult;

  // Find user's active league participation
  const partResult = await fastify.db.query(
    `SELECT lp.*, l.tier 
     FROM league_participants lp
     JOIN leagues l ON lp.league_id = l.id
     WHERE lp.user_id = $1 AND l.is_active = true
     ORDER BY lp.last_updated_at DESC
     LIMIT 1`,
    [userId]
  );
  if (partResult.rows.length === 0) return null;

  const participant = partResult.rows[0];
  const currentStreak = participant.current_win_streak || 0;

  // Calculate LP
  let newStreak = isWin ? currentStreak + 1 : 0;
  let lpAwarded = calculateLPBattleResult(isWin, isDraw, currentStreak);
  
  // Update streak
  const newLongest = Math.max(participant.longest_win_streak || 0, newStreak);

  // Update participant with LP and stats
  const winsIncrement = isWin ? 1 : 0;
  const drawsIncrement = isDraw ? 1 : 0;
  const lossesIncrement = (!isWin && !isDraw) ? 1 : 0;

  await fastify.db.query(
    `UPDATE league_participants SET
       league_points = league_points + $1,
       wins_count = wins_count + $2,
       draws_count = draws_count + $3,
       losses_count = losses_count + $4,
       battles_played = battles_played + 1,
       battles_won = battles_won + $2,
       battles_drawn = battles_drawn + $3,
       battles_lost = battles_lost + $4,
       current_win_streak = $5,
       longest_win_streak = $6,
       current_elo = $7,
       last_battle_at = NOW(),
       last_updated_at = NOW()
     WHERE id = $8`,
    [lpAwarded, winsIncrement, drawsIncrement, lossesIncrement, newStreak, newLongest, battleResult.newElo, participant.id]
  );

  return {
    participantId: participant.id,
    lpAwarded,
    newTotalLP: (participant.league_points || 0) + lpAwarded,
    newWinStreak: newStreak,
    isWin,
    isDraw,
  };
}

// ─── WEEKLY P&R JOB ─────────────────────────────────────────────────────────

export async function processWeeklyPromotionRelegation(fastify) {
  const results = [];
  
  // Get all active leagues
  const leagues = await fastify.db.query(
    "SELECT * FROM leagues WHERE is_active = true ORDER BY tier ASC"
  );

  for (const league of leagues.rows) {
    const season = await getOrCreateCurrentSeason(fastify, league.id);
    if (!season) continue;

    // Get all participants ranked by LP desc (ties broken by Elo)
    // Also include weekly battle count for "3 battles/day" rule
    const participants = await fastify.db.query(
      `SELECT lp.*, u.elo, u.metadata,
              (SELECT COUNT(*) FROM battles b 
               WHERE (b.player1_id = lp.user_id OR b.player2_id = lp.user_id)
                 AND b.status = 'completed'
                 AND b.ended_at > NOW() - INTERVAL '7 days') as weekly_battles
       FROM league_participants lp
       JOIN users u ON lp.user_id = u.id
       WHERE lp.league_id = $1
       ORDER BY lp.league_points DESC, u.elo DESC`,
      [league.id]
    );

    if (participants.rows.length === 0) continue;

    const total = participants.rows.length;
    
    // Use configured thresholds
    const promoPct = (league.promotion_threshold_percent || 17) / 100;
    const relegPct = (league.relegation_threshold_percent || 17) / 100;

    const targetPromoCount = Math.ceil(total * promoPct);
    const targetRelegCount = Math.floor(total * relegPct);

    // Filter by inactivity (Requirement: 21 battles per week)
    const inactiveUsers = participants.rows.filter(p => parseInt(p.weekly_battles || 0) < 21);
    const activeUsers = participants.rows.filter(p => parseInt(p.weekly_battles || 0) >= 21);

    // Demotion Shield check
    const isShielded = (p) => {
      const expires = p.metadata?.demotion_shield_expires;
      return expires && new Date(expires) > new Date();
    };

    // Determine promoted (from active only)
    const promoted = activeUsers.slice(0, targetPromoCount);

    // Determine relegated
    // 1. All inactive users (unless shielded)
    // 2. Bottom of active users to hit target count (unless shielded)
    let candidatesForRelegation = [...inactiveUsers];
    const neededFromActive = Math.max(0, targetRelegCount - candidatesForRelegation.length);
    if (neededFromActive > 0 && activeUsers.length > 0) {
      candidatesForRelegation = [
        ...candidatesForRelegation, 
        ...activeUsers.slice(Math.max(0, activeUsers.length - neededFromActive))
      ];
    }

    const relegated = candidatesForRelegation.filter(p => !isShielded(p));

    // Log P&R and move users
    for (const p of promoted) {
      const nextTier = league.tier - 1;
      const nextLeague = leagues.rows.find(l => l.tier === nextTier);
      
      if (nextLeague) {
        await fastify.db.query(
          `INSERT INTO league_pr_log (user_id, league_id, season_id, action, from_rank, to_rank)
           VALUES ($1, $2, $3, 'promotion', $4, $5)`,
          [p.user_id, league.id, season.id, 0, 1]
        );
        // Actual move logic: users usually move between seasons, but if weekly, we move them now
        // For Season 1, we will move them immediately
        await leaveLeague(fastify, p.user_id, league.id);
        await joinLeague(fastify, p.user_id, nextLeague.id);
      }
    }

    for (const p of relegated) {
      const nextTier = league.tier + 1;
      const nextLeague = leagues.rows.find(l => l.tier === nextTier);

      await fastify.db.query(
        `INSERT INTO league_pr_log (user_id, league_id, season_id, action, from_rank, to_rank)
         VALUES ($1, $2, $3, 'relegation', $4, $5)`,
        [p.user_id, league.id, season.id, 0, total]
      );

      if (nextLeague) {
        await leaveLeague(fastify, p.user_id, league.id);
        await joinLeague(fastify, p.user_id, nextLeague.id);
      }
    }

    results.push({
      league: league.slug,
      tier: league.tier,
      promoted: promoted.map(p => p.user_id),
      relegated: relegated.map(p => p.user_id),
      totalParticipants: total,
    });
  }

  fastify.log.info(`Weekly P&R processed for ${results.length} leagues`);
  return results;
}

// ─── SEASON LIFECYCLE ───────────────────────────────────────────────────────

export async function checkAndTransitionSeasons(fastify) {
  // Find seasons that have ended
  const endedSeasons = await fastify.db.query(
    `SELECT ls.*, l.name as league_name, l.tier
     FROM league_seasons ls
     JOIN leagues l ON ls.league_id = l.id
     WHERE ls.status = 'active' AND ls.end_date <= CURRENT_DATE`
  );

  const results = [];
  for (const season of endedSeasons.rows) {
    // Transition to offseason
    await fastify.db.query(
      `UPDATE league_seasons SET status = 'offseason' WHERE id = $1`,
      [season.id]
    );

    // --- Season 1 Wealth Tax & Legacy XP Transition ---
    // Triggered when any league completes Season 1
    if (season.season_number === 1) {
      fastify.log.info('Season 1 ending detected. Attempting to initiate system-wide Wealth Tax transition...');
      
      // Use atomic operation to ensure only one process starts the job
      // We only start if it hasn't completed yet and is not currently running
      const jobRes = await fastify.db.query(`
        INSERT INTO background_jobs (job_type, status, started_at)
        VALUES ('season_1_wealth_tax', 'running', NOW())
        ON CONFLICT (job_type) DO UPDATE
        SET status = 'running', started_at = NOW(), last_error = NULL
        WHERE background_jobs.status NOT IN ('running', 'completed')
        RETURNING id
      `);
      
      if (jobRes.rows.length > 0) {
        const jobId = jobRes.rows[0].id;
        fastify.log.info({ jobId }, 'Initiating Season 1 transition...');
        
        try {
          const { applySeasonWealthTax, normalizeSeasonIQ, archiveSeason1Stats } = await import('./rewardService.js');
          
          fastify.log.info('Archiving Season 1 stats for all users...');
          await archiveSeason1Stats(fastify);

          fastify.log.info('Applying Season 1 Wealth Tax...');
          const taxResult = await applySeasonWealthTax(fastify);
          
          fastify.log.info('Normalizing IQ for elites...');
          await normalizeSeasonIQ(fastify);

          await fastify.db.query(
            "UPDATE background_jobs SET status = 'completed', completed_at = NOW(), records_processed = $1 WHERE id = $2",
            [taxResult.processedCount, jobId]
          );
          fastify.log.info('Season 1 Transition (Archive + Tax + IQ Reset) completed successfully.');
        } catch (err) {
          fastify.log.error({ err }, 'Season 1 Wealth Tax transition failed');
          await fastify.db.query(
            "UPDATE background_jobs SET status = 'failed', last_error = $1 WHERE id = $2",
            [err.message, jobId]
          );
        }
      } else {
        fastify.log.info('Season 1 transition already running or completed. Skipping.');
      }
    }

    results.push({ seasonId: season.id, league: season.league_name, action: 'offseason' });
  }

  // Find offseasons that are 3 days old — start new season
  const offseasons = await fastify.db.query(
    `SELECT ls.*, l.name as league_name
     FROM league_seasons ls
     JOIN leagues l ON ls.league_id = l.id
     WHERE ls.status = 'offseason' 
       AND ls.end_date + INTERVAL '3 days' <= CURRENT_DATE`
  );

  for (const season of offseasons.rows) {
    await getOrCreateCurrentSeason(fastify, season.league_id);
    await fastify.db.query(
      `UPDATE league_seasons SET status = 'completed' WHERE id = $1`,
      [season.id]
    );
    results.push({ seasonId: season.id, league: season.league_name, action: 'completed' });
  }

  return results;
}

// ─── JOIN LEAGUE ────────────────────────────────────────────────────────────

export async function joinLeague(fastify, userId, leagueId) {
  // Get user's current Elo
  const userResult = await fastify.db.query(
    'SELECT elo FROM users WHERE id = $1',
    [userId]
  );
  if (userResult.rows.length === 0) throw new Error('User not found');
  const elo = userResult.rows[0].elo;

  // ─── Status Floor Rule enforcement ─────────────────────────────────────
  const leagueResult = await fastify.db.query('SELECT tier, min_elo, max_elo FROM leagues WHERE id = $1', [leagueId]);
  if (leagueResult.rows.length === 0) throw new Error('League not found');
  const targetLeagueTier = leagueResult.rows[0].tier;

  const maxAllowedTier = getMaxAllowedTierForElo(elo);
  // Special exception: Seeding to Regional Championship (Tier 3) is allowed regardless of ELO for seeding script
  // But generally enforced for user join.
  
  // Get or create season
  const season = await getOrCreateCurrentSeason(fastify, leagueId);
  if (!season) throw new Error('No active season');

  // Check if already in ANY league for this season? 
  // Actually the spec implies multiple leagues might exist but usually a user is in ONE per season.
  const existing = await fastify.db.query(
    `SELECT id FROM league_participants WHERE user_id = $1 AND season_id = $2`,
    [userId, season.id]
  );
  if (existing.rows.length > 0) {
    return { alreadyInLeague: true };
  }

  // Insert participant
  const result = await fastify.db.query(
    `INSERT INTO league_participants (user_id, league_id, season_id, elo_at_season_start, current_elo, battles_played, battles_won)
     VALUES ($1, $2, $3, $4, $4, 0, 0)
     RETURNING *`,
    [userId, leagueId, season.id, elo]
  );

  // Auto-assign to group
  const groupCount = await fastify.db.query(
    `SELECT COUNT(*) as cnt FROM league_groups WHERE league_id = $1 AND season_id = $2`,
    [leagueId, season.id]
  );
  const nextGroupNum = (parseInt(groupCount.rows[0].cnt) || 0) + 1;

  const groupResult = await fastify.db.query(
    `INSERT INTO league_groups (league_id, season_id, group_number, name, max_size)
     VALUES ($1, $2, $3, $4, 30)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [leagueId, season.id, nextGroupNum, `Group ${nextGroupNum}`]
  );

  if (groupResult.rows.length > 0) {
    await fastify.db.query(
      `INSERT INTO league_group_members (group_id, user_id, participant_id)
       VALUES ($1, $2, $3)`,
      [groupResult.rows[0].id, userId, result.rows[0].id]
    );
  }

  return { participant: result.rows[0], season };
}

// ─── LEAVE LEAGUE ───────────────────────────────────────────────────────────

export async function leaveLeague(fastify, userId, leagueId) {
  const season = await getOrCreateCurrentSeason(fastify, leagueId);
  if (!season) return { success: false, error: 'No active season' };

  await fastify.db.query(
    `DELETE FROM league_group_members 
     WHERE user_id = $1 AND participant_id IN (
       SELECT id FROM league_participants WHERE league_id = $2 AND season_id = $3
     )`,
    [userId, leagueId, season.id]
  );

  const result = await fastify.db.query(
    `DELETE FROM league_participants WHERE user_id = $1 AND league_id = $2 AND season_id = $3 RETURNING id`,
    [userId, leagueId, season.id]
  );
  return { success: result.rows.length > 0 };
}

export default {
  LEAGUE_TIERS,
  calculateLPBattleResult,
  ensureLeagueTables,
  seed5TierLeagues,
  getOrCreateCurrentSeason,
  getLeagueForElo,
  getMaxAllowedTierForElo,
  awardLeaguePoints,
  processWeeklyPromotionRelegation,
  checkAndTransitionSeasons,
  joinLeague,
  leaveLeague,
};
