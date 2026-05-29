/**
 * Surge Service
 * 
 * Handles emergency multipliers and surge-related logic.
 */

export const SURGE_TRIBE_SLUGS = [
  'nigeria',
  'ghana',
  'morocco',
  'uct-ikey-tigers',
  'wits-clever-boys'
];

/**
 * Check if a tribe is part of the current surge campaign
 * @param {string} tribeSlug 
 * @returns {boolean}
 */
export function isSurgeTribe(tribeSlug) {
  return SURGE_TRIBE_SLUGS.includes(tribeSlug);
}

/**
 * Get the nation points multiplier for a tribe
 * @param {string} tribeSlug 
 * @returns {number} Multiplier (default 1.0)
 */
export function getNationPointsMultiplier(tribeSlug) {
  return isSurgeTribe(tribeSlug) ? 2.0 : 1.0;
}

export default {
  SURGE_TRIBE_SLUGS,
  isSurgeTribe,
  getNationPointsMultiplier
};
