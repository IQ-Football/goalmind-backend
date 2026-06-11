import { createGuest, convertGuestToUser } from './guestService.js';
import { creditTokens, TRANSACTION_TYPES } from './goalTokenService.js';

/**
 * Suggest a tribe based on country code.
 */
export async function suggestTribe(fastify, countryCode) {
  const countryToTribeMapping = {
    'EG': 'al-ahly',         // Egypt -> Al Ahly
    'MA': 'raja-casablanca', // Morocco -> Raja
    'TN': 'esperance-de-tunis', // Tunisia -> Esperance
    'ZA': 'kaizer-chiefs',   // South Africa -> Kaizer Chiefs
    'TZ': 'simba-sc',        // Tanzania -> Simba
    'GH': 'asante-kotoko',   // Ghana -> Asante Kotoko
    'NG': 'enyimba-fc',      // Nigeria -> Enyimba
    'CD': 'tp-mazembe',      // DR Congo -> TP Mazembe
  };

  const suggestedSlug = countryToTribeMapping[countryCode.toUpperCase()] || 'al-ahly';

  const tribeResult = await fastify.db.query(
    'SELECT id, name, slug, logo_url, primary_color, secondary_color, region FROM tribes WHERE slug = $1',
    [suggestedSlug]
  );

  return tribeResult.rows[0] || null;
}

/**
 * Create a guest session.
 */
export async function createGuestSession(fastify, { tribeId, trialTokens = 0 }) {
    // If no tribeId provided, suggest one based on a default (e.g., NG)
    let effectiveTribeId = tribeId;
    if (!effectiveTribeId) {
        const suggestion = await suggestTribe(fastify, 'NG');
        effectiveTribeId = suggestion?.id;
    }

    if (!effectiveTribeId) {
        throw new Error('TRIBE_REQUIRED');
    }

    return await createGuest(fastify, { tribeId: effectiveTribeId, trialTokens });
}

/**
 * Get 3 easy questions for the Trial Blitz.
 */
export async function getTrialBlitzQuestions(fastify) {
  const questionsResult = await fastify.db.query(
    `SELECT id, content, options, difficulty, category 
     FROM questions 
     WHERE difficulty = 'easy'
     ORDER BY RANDOM() 
     LIMIT 3`
  );

  return questionsResult.rows;
}

/**
 * Merge guest data and award registration bonus.
 */
export async function mergeGuestData(fastify, userId) {
  // Award 50 GT registration bonus
  await creditTokens(fastify, {
    userId,
    amount: 50,
    type: TRANSACTION_TYPES.INITIAL_GRANT,
    metadata: { reason: 'ghost_mode_conversion_bonus' }
  });

  // Also award 50 Nation Points (Power Points)
  await fastify.db.query(
    'UPDATE users SET nation_points = COALESCE(nation_points, 0) + 50 WHERE id = $1',
    [userId]
  );

  return { success: true };
}

export default {
  suggestTribe,
  createGuestSession,
  getTrialBlitzQuestions,
  mergeGuestData
};
