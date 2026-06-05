import { v4 as uuidv4 } from 'uuid';

/**
 * Onboarding Service
 * Handles predictive tribe assignment, guest sessions, and trial battles.
 */

// Mapping of City/Country to Tribe Slugs (Big 15)
const GEO_IP_MAPPING = {
  'Cairo': { tribe: 'al-ahly', backup: 'zamalek', country: 'Egypt' },
  'Johannesburg': { tribe: 'kaizer-chiefs', backup: 'orlando-pirates', country: 'South Africa' },
  'Lagos': { tribe: 'enyimba-fc', backup: 'nigeria', country: 'Nigeria' },
  'Casablanca': { tribe: 'raja-casablanca', backup: 'wydad-casablanca', country: 'Morocco' },
  'Dar es Salaam': { tribe: 'simba-sc', backup: 'yanga-sc', country: 'Tanzania' },
  // Countries
  'Egypt': { tribe: 'al-ahly', backup: 'zamalek' },
  'South Africa': { tribe: 'kaizer-chiefs', backup: 'orlando-pirates' },
  'Nigeria': { tribe: 'enyimba-fc', backup: 'nigeria' },
  'Morocco': { tribe: 'raja-casablanca', backup: 'wydad-casablanca' },
  'Tanzania': { tribe: 'simba-sc', backup: 'yanga-sc' },
  'Ghana': { tribe: 'asante-kotoko', backup: 'ghana' },
  'Tunisia': { tribe: 'esperance-de-tunis', backup: 'tunisia' },
  'Libya': { tribe: 'al-ahli-tripoli', backup: 'libya' },
  'Zambia': { tribe: 'nkana-fc', backup: 'zambia' },
};

/**
 * Perform a mock Geo-IP lookup
 * In production, this would use a service like MaxMind or IPStack
 */
export async function lookupGeoIP(ip) {
  // Mock logic: return a random Big 15 location for testing, 
  // or a specific one if IP is known.
  const locations = Object.keys(GEO_IP_MAPPING);
  const randomLocation = locations[Math.floor(Math.random() * locations.length)];
  
  return {
    ip,
    city: randomLocation,
    country: GEO_IP_MAPPING[randomLocation].country || randomLocation,
    ...GEO_IP_MAPPING[randomLocation]
  };
}

/**
 * Suggest a tribe based on Geo-IP
 */
export async function suggestTribe(fastify, ip) {
  const geo = await lookupGeoIP(ip);
  const tribeSlug = geo.tribe;
  
  const res = await fastify.db.query(
    'SELECT id, name, slug, primary_color, secondary_color, logo_url FROM tribes WHERE slug = $1',
    [tribeSlug]
  );
  
  if (res.rows.length === 0) {
    // Try backup
    const backupRes = await fastify.db.query(
      'SELECT id, name, slug, primary_color, secondary_color, logo_url FROM tribes WHERE slug = $1',
      [geo.backup]
    );
    return { geo, tribe: backupRes.rows[0] || null };
  }
  
  return { geo, tribe: res.rows[0] };
}

/**
 * Create a new guest session
 */
export async function createGuestSession(fastify, tribeId) {
  const sessionId = uuidv4();
  const res = await fastify.db.query(
    'INSERT INTO guest_sessions (session_id, tribe_id) VALUES ($1, $2) RETURNING *',
    [sessionId, tribeId]
  );
  return res.rows[0];
}

/**
 * Get trial blitz questions
 */
export async function getTrialBlitzQuestions(fastify) {
  // Try Redis cache first
  const cached = await fastify.redis.get('onboarding:trial_questions');
  if (cached) {
    const questions = JSON.parse(cached);
    // Return 3 random ones from the cached pool
    return questions.sort(() => 0.5 - Math.random()).slice(0, 3);
  }

  // Fetch a pool of "easy" questions
  const res = await fastify.db.query(
    'SELECT id, content, options, correct_option_index, explanation FROM questions WHERE difficulty = \'easy\' LIMIT 50'
  );
  
  if (res.rows.length > 0) {
    await fastify.redis.setex('onboarding:trial_questions', 3600, JSON.stringify(res.rows));
  }

  return res.rows.sort(() => 0.5 - Math.random()).slice(0, 3);
}

/**
 * Record trial battle result
 */
export async function recordTrialResult(fastify, sessionId, score) {
  const res = await fastify.db.query(
    `UPDATE guest_sessions 
     SET battle_results = jsonb_set(battle_results, '{trial_blitz}', $1::jsonb)
     WHERE session_id = $2 
     RETURNING *`,
    [JSON.stringify({ score, completed_at: new Date() }), sessionId]
  );
  return res.rows[0];
}

/**
 * Merge guest data into a permanent user account
 */
export async function mergeGuestData(fastify, sessionId, userId) {
  const guestRes = await fastify.db.query('SELECT * FROM guest_sessions WHERE session_id = $1', [sessionId]);
  if (guestRes.rows.length === 0) return null;
  
  const guest = guestRes.rows[0];
  const trialBlitz = guest.battle_results?.trial_blitz;
  
  if (trialBlitz) {
    // Add Power Points to tribe (e.g., +50 as per spec)
    await fastify.db.query(
      'UPDATE tribes SET total_points = total_points + 50 WHERE id = $1',
      [guest.tribe_id]
    );
    
    // Add contribution points to user
    await fastify.db.query(
      'UPDATE tribe_members SET contribution_points = contribution_points + 50 WHERE user_id = $1',
      [userId]
    );
    
    // Record the fact that this user was merged from a trial
    await fastify.db.query(
      "UPDATE users SET metadata = jsonb_set(metadata, '{onboarding, trial_completed}', 'true') WHERE id = $1",
      [userId]
    );
    
    // Delete guest session
    await fastify.db.query('DELETE FROM guest_sessions WHERE session_id = $1', [sessionId]);
  }
  
  return { success: true };
}

export default {
  suggestTribe,
  createGuestSession,
  getTrialBlitzQuestions,
  recordTrialResult,
  mergeGuestData
};
