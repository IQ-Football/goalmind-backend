import config from '../config.js';
import { processWeeklyPromotionRelegation, checkAndTransitionSeasons } from './leagueSystemService.js';
import { getActiveSeason, updateAllTpi } from './continentalCupService.js';

/**
 * Background Jobs Service
 * Handles periodic cleanup and maintenance tasks for WC 2026 features,
 * plus League System P&R scheduling.
 * Uses simple setInterval for lightweight job scheduling.
 * For production at scale, consider BullMQ.
 */

// WC2026 Job intervals in milliseconds
const VAR_CLEANUP_INTERVAL_MS = 30 * 1000; // Every 30 seconds
const PREDICTION_VALIDATION_INTERVAL_MS = 60 * 60 * 1000; // Every hour

// League System Job intervals
const SEASON_TRANSITION_CHECK_MS = 60 * 60 * 1000; // Every hour (check for season end/offseason)
const CONTINENTAL_CUP_UPDATE_MS = 60 * 60 * 1000; // Every hour
const WEEKLY_PR_CHECK_DAY_MS = 7 * 24 * 60 * 60 * 1000; // Weekly (but we track day-of-week)

let varCleanupTimer = null;
let predictionValidationTimer = null;
let seasonTransitionTimer = null;
let continentalCupTimer = null;
let weeklyPRTimer = null;
let lastPRProcessedDay = -1;

/**
 * Start all background jobs
 */
export function startBackgroundJobs(fastify) {
  fastify.log.info('Starting background jobs...');

  // P0-5: VAR event cleanup - close expired events
  varCleanupTimer = setInterval(() => {
    cleanupExpiredVAREvents(fastify).catch(err => {
      fastify.log.error({ err }, 'VAR cleanup job failed');
    });
  }, VAR_CLEANUP_INTERVAL_MS);

  // P0-5: Prediction validation - score predictions against completed matches
  predictionValidationTimer = setInterval(() => {
    validatePredictions(fastify).catch(err => {
      fastify.log.error({ err }, 'Prediction validation job failed');
    });
  }, PREDICTION_VALIDATION_INTERVAL_MS);

  // ─── League System: Season Transition Check (every hour) ─────────────────
  seasonTransitionTimer = setInterval(() => {
    checkAndTransitionSeasons(fastify).catch(err => {
      fastify.log.error({ err }, 'Season transition check failed');
    });
  }, SEASON_TRANSITION_CHECK_MS);

  // ─── Continental Cup: TPI Update (every hour) ───────────────────────────
  continentalCupTimer = setInterval(async () => {
    try {
      const season = await getActiveSeason(fastify);
      if (season) {
        await updateAllTpi(fastify, season.id);
        fastify.log.info(`Continental Cup TPI updated for season ${season.name}`);
      }
    } catch (err) {
      fastify.log.error({ err }, 'Continental Cup TPI update failed');
    }
  }, CONTINENTAL_CUP_UPDATE_MS);

  // ─── League System: Weekly P&R (every hour, but only runs on Sunday) ────
  weeklyPRTimer = setInterval(() => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday

    // Run P&R only once per week (Sunday at 23:59 would be ideal)
    // For safety, we run the check hourly but only process on day 0 (Sunday)
    // and only if it hasn't been run this week
    if (dayOfWeek === 0 && lastPRProcessedDay !== dayOfWeek) {
      processWeeklyPromotionRelegation(fastify)
        .then(results => {
          fastify.log.info(`Weekly P&R complete: ${results.length} leagues processed`);
          lastPRProcessedDay = dayOfWeek;
        })
        .catch(err => {
          fastify.log.error({ err }, 'Weekly P&R failed');
        });
    }
  }, SEASON_TRANSITION_CHECK_MS); // Reuse same interval since both are hourly

  fastify.log.info('Background jobs started (WC2026 + League System)');
}

/**
 * Stop all background jobs
 */
export function stopBackgroundJobs() {
  if (varCleanupTimer) clearInterval(varCleanupTimer);
  if (predictionValidationTimer) clearInterval(predictionValidationTimer);
  if (seasonTransitionTimer) clearInterval(seasonTransitionTimer);
  if (continentalCupTimer) clearInterval(continentalCupTimer);
  if (weeklyPRTimer) clearInterval(weeklyPRTimer);
}

/**
 * P0-5: Cleanup expired VAR events
 * Sets is_active = false for events where expires_at < NOW()
 */
async function cleanupExpiredVAREvents(fastify) {
  const result = await fastify.db.query(
    `UPDATE wc2026_var_events 
     SET is_active = false 
     WHERE is_active = true 
       AND expires_at < NOW() 
       AND expires_at IS NOT NULL`,
    []
  );

  if (result.rowCount > 0) {
    fastify.log.info(`VAR cleanup: deactivated ${result.rowCount} expired VAR events`);
    
    // Broadcast expiration via Socket.IO to all WC2026 namespace clients
    const io = fastify.io;
    if (io) {
      io.of('/wc2026').emit('var:expired', { 
        count: result.rowCount,
        timestamp: new Date().toISOString()
      });
    }
  }

  return result.rowCount;
}

/**
 * P0-5: Validate predictions against completed matches
 * Awards points based on correct predictions
 */
async function validatePredictions(fastify) {
  // Find completed matches that haven't had their predictions scored
  const matchesResult = await fastify.db.query(
    `SELECT m.id, m.team1_id, m.team2_id, m.team1_score, m.team2_score, m.status
     FROM wc2026_matches m
     WHERE m.status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM wc2026_predictions p 
         WHERE p.match_id = m.id AND p.points_earned >= 0
       )
     LIMIT 50`,
    []
  );

  let totalScored = 0;

  for (const match of matchesResult.rows) {
    // Determine actual winner
    let actualWinner = 'draw';
    if (match.team1_score > match.team2_score) {
      actualWinner = match.team1_id;
    } else if (match.team2_score > match.team1_score) {
      actualWinner = match.team2_id;
    }

    // Score all predictions for this match
    const predictionsResult = await fastify.db.query(
      `SELECT p.id, p.user_id, p.predicted_winner, p.predicted_team1_score, p.predicted_team2_score,
              u.national_tribe_id
       FROM wc2026_predictions p
       JOIN users u ON u.id = p.user_id
       WHERE p.match_id = $1`,
      [match.id]
    );

    for (const pred of predictionsResult.rows) {
      let points = 0;
      let isCorrect = false;

      // Check winner prediction
      if (pred.predicted_winner === actualWinner) {
        points += 10;
        isCorrect = true;
      }

      // Check exact score prediction (bonus)
      if (pred.predicted_team1_score === match.team1_score &&
          pred.predicted_team2_score === match.team2_score) {
        points += 15;
      }

      // Update prediction with points earned
      await fastify.db.query(
        `UPDATE wc2026_predictions 
         SET points_earned = $1 
         WHERE id = $2`,
        [points, pred.id]
      );

      // Update user stats
      await fastify.db.query(
        `INSERT INTO wc2026_user_stats (user_id, predictions_made, predictions_correct, total_iq_earned)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           predictions_made = wc2026_user_stats.predictions_made + 1,
           predictions_correct = wc2026_user_stats.predictions_correct + $2,
           total_iq_earned = wc2026_user_stats.total_iq_earned + $3,
           last_updated = NOW()`,
        [pred.user_id, isCorrect ? 1 : 0, points]
      );

      // Apply multiplier if active
      if (pred.multiplier_active && pred.multiplier_expires > new Date()) {
        await fastify.db.query(
          `UPDATE wc2026_user_stats 
           SET multiplier_seconds_left = multiplier_seconds_left + 3600
           WHERE user_id = $1`,
          [pred.user_id]
        );
      }

      // Update national pride score if prediction was correct
      if (isCorrect && pred.national_tribe_id) {
        await fastify.db.query(
          `UPDATE user_national_tribes 
           SET national_pride_score = national_pride_score + 1 
           WHERE user_id = $1 AND national_tribe_id = $2`,
          [pred.user_id, pred.national_tribe_id]
        );
      }

      totalScored++;
    }
  }

  if (totalScored > 0) {
    fastify.log.info(`Prediction validation: scored ${totalScored} predictions`);
    
    // Broadcast via Socket.IO
    const io = fastify.io;
    if (io) {
      io.of('/wc2026').emit('predictions:scored', { 
        count: totalScored,
        timestamp: new Date().toISOString()
      });
    }
  }

  return totalScored;
}

/**
 * Manually trigger VAR cleanup (useful for testing or admin action)
 */
export async function triggerVARCleanup(fastify) {
  return cleanupExpiredVAREvents(fastify);
}

/**
 * Manually trigger prediction validation
 */
export async function triggerPredictionValidation(fastify) {
  return validatePredictions(fastify);
}

export default {
  startBackgroundJobs,
  stopBackgroundJobs,
  triggerVARCleanup,
  triggerPredictionValidation,
};
