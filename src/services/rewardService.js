import { FOUNDING_GENERAL_ID, awardBadgeWithClient } from './achievementService.js';
import { broadcastTournamentUpdate } from './tournamentLeaderboardService.js';

/**
 * Reward Service
 * Handles seasonal reward distribution, GoalToken awards, and Hall of Generals induction.
 */

export async function distributeSeasonalRewards(fastify, leagueId, seasonId) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Get league info
    const leagueRes = await client.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
    const league = leagueRes.rows[0];
    if (!league) throw new Error('League not found');

    // 2. Get all participants
    const participants = await client.query(
      `SELECT lp.*, u.username 
       FROM league_participants lp
       JOIN users u ON lp.user_id = u.id
       WHERE lp.league_id = $1 AND lp.season_id = $2
       ORDER BY lp.league_points DESC, u.elo DESC`,
      [leagueId, seasonId]
    );

    // 3. For each participant, award GoalTokens and Badges
    for (const p of participants.rows) {
       const rewardGT = league.reward_goal_tokens || 0;
       const badgeName = league.reward_badge_name;

       // Update GoalTokens (using both column and metadata for backward compatibility)
       await client.query(
         `UPDATE users SET 
          goal_tokens = COALESCE(goal_tokens, 0) + $1,
          metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{goal_tokens}', 
          to_jsonb(COALESCE((metadata->>'goal_tokens')::int, 0) + $1)) 
          WHERE id = $2`,
         [rewardGT, p.user_id]
       );

       // Award badge if exists
       if (badgeName) {
         const achRes = await client.query('SELECT id FROM achievements WHERE name = $1', [badgeName]);
         if (achRes.rows.length > 0) {
           await client.query(
             'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
             [p.user_id, achRes.rows[0].id]
           );
         }
       }
    }

    await client.query('COMMIT');
    return { success: true, count: participants.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, leagueId, seasonId }, 'Error distributing seasonal rewards');
    throw err;
  } finally {
    client.release();
  }
}

export async function inductToHallOfGenerals(fastify, userId, reason) {
  try {
    // Check if hall_of_generals table exists, create if not
    await fastify.db.query(`
      CREATE TABLE IF NOT EXISTS hall_of_generals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        tribe_id UUID REFERENCES tribes(id),
        reason TEXT,
        inducted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const userRes = await fastify.db.query('SELECT tribe_id FROM users WHERE id = $1', [userId]);
    const tribeId = userRes.rows[0]?.tribe_id;

    await fastify.db.query(
      'INSERT INTO hall_of_generals (user_id, tribe_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, tribeId, reason]
    );
    
    return true;
  } catch (err) {
    fastify.log.error({ err, userId }, 'Error inducting to Hall of Generals');
    return false;
  }
}

export async function finalizeRelayTournament(fastify, relayId, winnerTribeId, participants) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 0. Update relay_matches table with final result
    const relayRes = await client.query('SELECT * FROM relay_matches WHERE id = $1', [relayId]);
    if (relayRes.rows.length > 0) {
      // Get scores from Redis since they were updated there
      const relayKey = `relay:${relayId}:state`;
      const scoreA = await fastify.redis.hget(relayKey, 'tribeA_score');
      const scoreB = await fastify.redis.hget(relayKey, 'tribeB_score');
      
      await client.query(
        `UPDATE relay_matches 
         SET status = 'completed', 
             winner_tribe_id = $1, 
             tribe_a_score = $2, 
             tribe_b_score = $3 
         WHERE id = $4`,
        [winnerTribeId, parseFloat(scoreA || 0), parseFloat(scoreB || 0), relayId]
      );
    } else {
      // Fallback if match wasn't in DB yet
      const relayKey = `relay:${relayId}:state`;
      const data = await fastify.redis.hgetall(relayKey);
      await client.query(
        `INSERT INTO relay_matches (id, tribe_a_id, tribe_b_id, tribe_a_score, tribe_b_score, winner_tribe_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'completed')`,
        [
          relayId, 
          data.tribeA_id, 
          data.tribeB_id, 
          parseFloat(data.tribeA_score || 0), 
          parseFloat(data.tribeB_score || 0), 
          winnerTribeId
        ]
      );
    }

    // 1. Enable seasonal skin for winning tribe
    // Ensure column exists
    await client.query("ALTER TABLE tribes ADD COLUMN IF NOT EXISTS seasonal_skin_enabled BOOLEAN DEFAULT false");
    await client.query("UPDATE tribes SET seasonal_skin_enabled = true WHERE id = $1", [winnerTribeId]);

    // 2. Award Eternal Titan badge to winners
    const ETERNAL_TITAN_ID = '550e8400-e29b-41d4-a716-446655440007';
    for (const userId of participants) {
      await awardBadgeWithClient(client, userId, ETERNAL_TITAN_ID, fastify.log);
      
      // 3. Induct to Hall of Generals
      await inductToHallOfGenerals(fastify, userId, 'Season 1 Relay Winner');
    }

    await client.query('COMMIT');

    // 4. Broadcast tournament leaderboard update
    if (fastify.tournamentNamespace) {
      broadcastTournamentUpdate(fastify, fastify.tournamentNamespace);
    }

    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, relayId }, 'Error finalizing relay tournament');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply Season 1 "Wealth Tax" as per SEASON_1_ECONOMY_AND_PRESTIGE_SPEC.md
 * - Carryover Rate: 50% of current GT balance.
 * - Max Carryover Cap: 5,000 GT.
 * - Compensation: Lost tokens converted to "Legacy XP".
 */
export async function applySeasonWealthTax(fastify) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    
    fastify.log.info('Applying Season 1 Wealth Tax...');

    // We process all users. Note: goal_tokens is a column in the users table.
    // Based on the spec, we should also check metadata if tokens were stored there by mistake, 
    // but the users table has a primary goal_tokens column now.
    
    const usersRes = await client.query('SELECT id, goal_tokens, metadata, username FROM users');
    let processedCount = 0;
    let totalLostGT = 0;

    for (const user of usersRes.rows) {
      const currentGT = parseInt(user.goal_tokens || 0);
      if (currentGT <= 0) continue;

      // Calculate new balance: 50% carryover, capped at 5000
      let newGT = Math.floor(currentGT * 0.5);
      if (newGT > 5000) newGT = 5000;

      const lostGT = currentGT - newGT;
      totalLostGT += lostGT;

      // Update goal_tokens column and metadata (legacy_xp/arena_level)
      const metadata = user.metadata || {};
      const currentLegacyXP = parseInt(metadata.legacy_xp || 0);
      const newLegacyXP = currentLegacyXP + lostGT;
      
      // Arena Level calculation: 1 level per 1000 Legacy XP
      const arenaLevel = Math.floor(newLegacyXP / 1000) + 1;

      const updatedMetadata = {
        ...metadata,
        s1_final_gt: currentGT,
        wealth_tax_applied_at: new Date().toISOString()
      };

      await client.query(
        'UPDATE users SET goal_tokens = $1, legacy_xp = $2, arena_level = $3, metadata = $4 WHERE id = $5',
        [newGT, newLegacyXP, arenaLevel, JSON.stringify(updatedMetadata), user.id]
      );
      
      processedCount++;
      if (processedCount % 100 === 0) {
        fastify.log.info({ processedCount }, 'Wealth Tax: Still processing users...');
      }
    }

    await client.query('COMMIT');
    fastify.log.info({ processedCount, totalLostGT }, 'Season 1 Wealth Tax applied successfully');
    return { success: true, processedCount, totalLostGT };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err }, 'Error applying Season 1 Wealth Tax');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Normalize IQ for Season 2 transition
 * - All users in Global Arena (Tier 1) and Premier (Tier 2) reset to 1,800.
 * - Others retain their Elo.
 */
export async function normalizeSeasonIQ(fastify) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    fastify.log.info('Normalizing IQ for Season 2...');

    // Find users in Tier 1 and 2
    // We join with league_participants to find their current tier
    const usersToReset = await client.query(`
      SELECT u.id 
      FROM users u
      JOIN league_participants lp ON u.id = lp.user_id
      JOIN leagues l ON lp.league_id = l.id
      WHERE l.tier IN (1, 2) AND l.is_active = true
    `);

    for (const user of usersToReset.rows) {
      await client.query(
        'UPDATE users SET elo = 1800 WHERE id = $1',
        [user.id]
      );
    }

    await client.query('COMMIT');
    fastify.log.info({ count: usersToReset.rows.length }, 'IQ Normalization complete');
    return { success: true, count: usersToReset.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err }, 'Error normalizing IQ');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Archive Season 1 stats to user metadata
 */
export async function archiveSeason1Stats(fastify) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    fastify.log.info('Archiving Season 1 stats...');

    const participants = await client.query(`
      SELECT lp.*, l.name as league_name, l.tier
      FROM league_participants lp
      JOIN leagues l ON lp.league_id = l.id
      WHERE lp.season_id IN (SELECT id FROM league_seasons WHERE season_number = 1)
    `);

    for (const p of participants.rows) {
      const userRes = await client.query('SELECT metadata FROM users WHERE id = $1', [p.user_id]);
      const metadata = userRes.rows[0]?.metadata || {};
      
      const s1Archive = {
        peak_iq: p.current_elo, // Simplification: using final elo as peak if not tracked separately
        final_division: p.league_name,
        final_tier: p.tier,
        total_battles: p.battles_played,
        total_wins: p.battles_won
      };

      const updatedMetadata = {
        ...metadata,
        s1_archive: s1Archive,
        badges: {
          ... (metadata.badges || {}),
          s1_service_medal: true
        }
      };

      await client.query(
        'UPDATE users SET metadata = $1 WHERE id = $2',
        [JSON.stringify(updatedMetadata), p.user_id]
      );
    }

    await client.query('COMMIT');
    fastify.log.info({ count: participants.rows.length }, 'Season 1 archiving complete');
    return { success: true, count: participants.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err }, 'Error archiving Season 1 stats');
    throw err;
  } finally {
    client.release();
  }
}

export default {
  distributeSeasonalRewards,
  inductToHallOfGenerals,
  finalizeRelayTournament,
  applySeasonWealthTax,
  normalizeSeasonIQ,
  archiveSeason1Stats
};
