import { v4 as uuidv4 } from 'uuid';

/**
 * WC 2026 Service
 *
 * National Tribes, Knockout Brackets, Predictions, and VAR Battle hooks.
 */

// ============================================================
// NATIONAL TRIBES
// ============================================================

/**
 * Get all national tribes
 */
export async function getNationalTribes(fastify) {
  try {
    const result = await fastify.db.query(
      `SELECT id, name, flag_emoji, group_letter FROM national_tribes ORDER BY group_letter, name`
    );
    return result.rows;
  } catch (err) {
    fastify.log.error(err);
    return [];
  }
}

/**
 * Get user's selected national tribe
 */
export async function getUserNationalTribe(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT nt.id, nt.name, nt.flag_emoji, nt.group_letter, unt.national_pride_score
       FROM user_national_tribes unt
       JOIN national_tribes nt ON nt.id = unt.national_tribe_id
       WHERE unt.user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    fastify.log.error(err);
    return null;
  }
}

/**
 * Select/change user's national tribe
 */
export async function selectNationalTribe(fastify, userId, nationId) {
  try {
    // Verify nation exists
    const nation = await fastify.db.query(`SELECT id FROM national_tribes WHERE id = $1`, [nationId]);
    if (nation.rows.length === 0) {
      return { success: false, reason: 'nation_not_found' };
    }

    await fastify.db.query(
      `INSERT INTO user_national_tribes (user_id, national_tribe_id, selected_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET national_tribe_id = $2, selected_at = NOW()`,
      [userId, nationId]
    );

    // Initialize WC stats if not exists
    await fastify.db.query(
      `INSERT INTO wc2026_user_stats (user_id, national_tribe_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET national_tribe_id = $2`,
      [userId, nationId]
    );

    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false, reason: 'db_error' };
  }
}

/**
 * Add national pride score for a user
 */
export async function addNationalPrideScore(fastify, userId, points) {
  try {
    await fastify.db.query(
      `UPDATE user_national_tribes SET national_pride_score = national_pride_score + $2 WHERE user_id = $1`,
      [userId, points]
    );
  } catch (err) {
    fastify.log.error(err);
  }
}

// ============================================================
// WC 2026 MATCHES
// ============================================================

/**
 * Get all WC 2026 matches (optionally by stage)
 */
export async function getWC2026Matches(fastify, stage = null) {
  try {
    let query = `
      SELECT m.*,
             t1.name as team1_name, t1.flag_emoji as team1_flag,
             t2.name as team2_name, t2.flag_emoji as team2_flag
      FROM wc2026_matches m
      LEFT JOIN national_tribes t1 ON t1.id = m.team1_id
      LEFT JOIN national_tribes t2 ON t2.id = m.team2_id
    `;
    const params = [];
    if (stage) {
      query += ` WHERE m.stage = $1`;
      params.push(stage);
    }
    query += ` ORDER BY m.match_date ASC`;

    const result = await fastify.db.query(query, params);
    return result.rows;
  } catch (err) {
    fastify.log.error(err);
    return [];
  }
}

/**
 * Get active WC matches (live now or upcoming soon)
 */
export async function getActiveWCMatches(fastify) {
  try {
    const result = await fastify.db.query(
      `SELECT m.*, t1.name as team1_name, t1.flag_emoji as team1_flag,
              t2.name as team2_name, t2.flag_emoji as team2_flag
       FROM wc2026_matches m
       LEFT JOIN national_tribes t1 ON t1.id = m.team1_id
       LEFT JOIN national_tribes t2 ON t2.id = m.team2_id
       WHERE m.is_active = true OR m.status = 'live'
       ORDER BY m.match_date ASC`
    );
    return result.rows;
  } catch (err) {
    fastify.log.error(err);
    return [];
  }
}

/**
 * Set match as active (triggers prediction/VAR battles)
 */
export async function activateMatch(fastify, matchId) {
  try {
    await fastify.db.query(`UPDATE wc2026_matches SET is_active = true, status = 'live' WHERE id = $1`, [matchId]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

/**
 * Deactivate match
 */
export async function deactivateMatch(fastify, matchId) {
  try {
    await fastify.db.query(`UPDATE wc2026_matches SET is_active = false WHERE id = $1`, [matchId]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
  }
}

// ============================================================
// PREDICTIONS
// ============================================================

/**
 * Submit a prediction for a match
 */
export async function submitPrediction(fastify, userId, matchId, prediction) {
  try {
    const { predicted_winner, predicted_team1_score, predicted_team2_score, predicted_first_scorer } = prediction;

    await fastify.db.query(
      `INSERT INTO wc2026_predictions
       (user_id, match_id, predicted_winner, predicted_team1_score, predicted_team2_score, predicted_first_scorer)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, match_id) DO UPDATE SET
         predicted_winner = $3,
         predicted_team1_score = $4,
         predicted_team2_score = $5,
         predicted_first_scorer = $6`,
      [userId, matchId, predicted_winner, predicted_team1_score, predicted_team2_score, predicted_first_scorer]
    );

    // Update stats
    await fastify.db.query(
      `INSERT INTO wc2026_user_stats (user_id, predictions_made)
       VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET predictions_made = wc2026_user_stats.predictions_made + 1`,
      [userId]
    );

    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false, reason: 'db_error' };
  }
}

/**
 * Get user's predictions for WC 2026
 */
export async function getUserPredictions(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT p.*, m.match_number, m.stage, m.team1_id, m.team2_id, m.match_date,
              t1.name as team1_name, t1.flag_emoji as team1_flag,
              t2.name as team2_name, t2.flag_emoji as team2_flag
       FROM wc2026_predictions p
       JOIN wc2026_matches m ON m.id = p.match_id
       LEFT JOIN national_tribes t1 ON t1.id = m.team1_id
       LEFT JOIN national_tribes t2 ON t2.id = m.team2_id
       WHERE p.user_id = $1
       ORDER BY m.match_date ASC`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    fastify.log.error(err);
    return [];
  }
}

/**
 * Check and activate multiplier for a user (called after correct prediction)
 */
export async function activatePredictionMultiplier(fastify, userId) {
  try {
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await fastify.db.query(
      `UPDATE wc2026_predictions SET multiplier_active = true, multiplier_expires = $2 WHERE user_id = $1`,
      [userId, expires]
    );
    return { success: true, expires };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

// ============================================================
// VAR BATTLES
// ============================================================

/**
 * Create a VAR battle event (called by admin/external match feed)
 */
export async function createVAREvent(fastify, matchId, varType, description, eventMinute) {
  try {
    const expires = new Date(Date.now() + 60 * 1000); // 60 seconds to enter
    const result = await fastify.db.query(
      `INSERT INTO wc2026_var_events (id, match_id, var_type, description, event_minute, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [uuidv4(), matchId, varType, description, eventMinute, expires]
    );
    return { success: true, event: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

/**
 * Get active VAR events for a match
 */
export async function getActiveVAREevents(fastify, matchId = null) {
  try {
    let query = `
      SELECT ve.*, m.match_number, m.stage,
             t1.name as team1_name, t1.flag_emoji as team1_flag,
             t2.name as team2_name, t2.flag_emoji as team2_flag
      FROM wc2026_var_events ve
      JOIN wc2026_matches m ON m.id = ve.match_id
      LEFT JOIN national_tribes t1 ON t1.id = m.team1_id
      LEFT JOIN national_tribes t2 ON t2.id = m.team2_id
      WHERE ve.is_active = true AND ve.expires_at > NOW()
    `;
    const params = [];
    if (matchId) {
      query += ` AND ve.match_id = $1`;
      params.push(matchId);
    }

    const result = await fastify.db.query(query, params);
    return result.rows;
  } catch (err) {
    fastify.log.error(err);
    return [];
  }
}

/**
 * Enter a VAR battle (marks user participation)
 */
export async function enterVARBattle(fastify, userId, varEventId) {
  try {
    await fastify.db.query(
      `INSERT INTO wc2026_user_stats (user_id, var_battles_entered)
       VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET var_battles_entered = wc2026_user_stats.var_battles_entered + 1`,
      [userId]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

/**
 * Record VAR battle win
 */
export async function recordVARBattleWin(fastify, userId) {
  try {
    await fastify.db.query(
      `UPDATE wc2026_user_stats SET var_battles_won = var_battles_won + 1 WHERE user_id = $1`,
      [userId]
    );
  } catch (err) {
    fastify.log.error(err);
  }
}

/**
 * Close expired VAR events
 */
export async function closeExpiredVAREevents(fastify) {
  try {
    await fastify.db.query(
      `UPDATE wc2026_var_events SET is_active = false WHERE is_active = true AND expires_at <= NOW()`
    );
  } catch (err) {
    fastify.log.error(err);
  }
}

// ============================================================
// KNOCKOUT BRACKETS
// ============================================================

/**
 * Enter a knockout bracket
 */
export async function enterKnockoutBracket(fastify, userId, bracketId) {
  try {
    await fastify.db.query(
      `INSERT INTO knockout_entries (id, user_id, bracket_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, bracket_id) DO NOTHING`,
      [uuidv4(), userId, bracketId]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

/**
 * Record a knockout round win (increment streak)
 */
export async function recordKnockoutWin(fastify, userId, bracketId) {
  try {
    const result = await fastify.db.query(
      `UPDATE knockout_entries
       SET streak_wins = streak_wins + 1,
           knockout_trophy = CASE WHEN streak_wins + 1 >= 4 THEN true ELSE knockout_trophy END
       WHERE user_id = $1 AND bracket_id = $2
       RETURNING streak_wins, knockout_trophy`,
      [userId, bracketId]
    );

    if (result.rows.length === 0) return { success: false };

    const { streak_wins, knockout_trophy } = result.rows[0];
    return { success: true, streak_wins, knockout_trophy };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

/**
 * Eliminate a user from knockout bracket
 */
export async function eliminateFromKnockout(fastify, userId, bracketId) {
  try {
    await fastify.db.query(
      `UPDATE knockout_entries SET eliminated = true WHERE user_id = $1 AND bracket_id = $2`,
      [userId, bracketId]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false };
  }
}

/**
 * Get user's knockout bracket status
 */
export async function getUserKnockoutStatus(fastify, userId, bracketId) {
  try {
    const result = await fastify.db.query(
      `SELECT ke.*, kb.bracket_name, kb.round
       FROM knockout_entries ke
       JOIN knockout_brackets kb ON kb.id = ke.bracket_id
       WHERE ke.user_id = $1 AND ke.bracket_id = $2`,
      [userId, bracketId]
    );
    return result.rows[0] || null;
  } catch (err) {
    fastify.log.error(err);
    return null;
  }
}

// ============================================================
// WC 2026 USER STATS
// ============================================================

/**
 * Get user's WC 2026 stats
 */
export async function getWC2026UserStats(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT s.*, nt.name as nation_name, nt.flag_emoji
       FROM wc2026_user_stats s
       LEFT JOIN national_tribes nt ON nt.id = s.national_tribe_id
       WHERE s.user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    fastify.log.error(err);
    return null;
  }
}

/**
 * Award multiplier seconds (from prediction correctness)
 */
export async function addMultiplierSeconds(fastify, userId, seconds) {
  try {
    await fastify.db.query(
      `UPDATE wc2026_user_stats SET multiplier_seconds_left = multiplier_seconds_left + $2 WHERE user_id = $1`,
      [userId, seconds]
    );
  } catch (err) {
    fastify.log.error(err);
  }
}

// ============================================================
// WORLD CUP CHAMPION REWARDS
// ============================================================

/**
 * Award champion rewards when a nation wins
 */
export async function awardChampionRewards(fastify, nationId) {
  try {
    // Check if already awarded
    const existing = await fastify.db.query(
      `SELECT id FROM wc2026_champion_rewards WHERE winning_nation_id = $1`,
      [nationId]
    );
    if (existing.rows.length > 0) {
      return { success: false, reason: 'already_awarded' };
    }

    // Record the award
    await fastify.db.query(
      `INSERT INTO wc2026_champion_rewards (winning_nation_id, badge_granted, gems_distributed, legacy_skin_granted)
       VALUES ($1, true, true, true)`,
      [nationId]
    );

    // Update all users of that nation with rewards
    await fastify.db.query(
      `UPDATE users SET
         metadata = jsonb_set(jsonb_set(metadata, '{wc2026_badge}', '"world_champion_2026"'), '{wc2026_legacy_skin}', '"world_champion_2026"')
       WHERE id IN (SELECT user_id FROM user_national_tribes WHERE national_tribe_id = $1)`,
      [nationId]
    );

    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return { success: false, reason: 'db_error' };
  }
}

export default {
  // National tribes
  getNationalTribes,
  getUserNationalTribe,
  selectNationalTribe,
  addNationalPrideScore,
  // Matches
  getWC2026Matches,
  getActiveWCMatches,
  activateMatch,
  deactivateMatch,
  // Predictions
  submitPrediction,
  getUserPredictions,
  activatePredictionMultiplier,
  // VAR battles
  createVAREvent,
  getActiveVAREevents,
  enterVARBattle,
  recordVARBattleWin,
  closeExpiredVAREevents,
  // Knockout
  enterKnockoutBracket,
  recordKnockoutWin,
  eliminateFromKnockout,
  getUserKnockoutStatus,
  // Stats
  getWC2026UserStats,
  addMultiplierSeconds,
  // Champion rewards
  awardChampionRewards,
};
