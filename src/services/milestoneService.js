/**
 * Milestone Service — Epic Achievements
 * Handles system-wide milestones and ritual logic
 */

import { awardBadge } from './achievementService.js';

const STADIUM_FOUNDER_TITLE = 'Stadium Founder';
const CENTURION_PRIME_TITLE = 'Centurion Prime';
const ARES_SURGE_ID = '770e8400-e29b-41d4-a716-446655440002';
const CENTURION_SURGE_ID = '770e8400-e29b-41d4-a716-446655440003';
const MILESTONE_25K = 25000;
const MILESTONE_50K = 50000;

/**
 * Trigger the 25k Milestone Ritual
 */
export async function trigger25kMilestone(fastify, userId) {
  fastify.log.info({ userId }, '25k Milestone reached! Starting ritual...');

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Award the 25,000th user rewards
    // Stadium Key relic (5,000 GT) and Stadium Founder title
    await client.query(`
      UPDATE users 
      SET goal_tokens = goal_tokens + 5000,
          title = $1,
          metadata = COALESCE(metadata, '{}'::jsonb) || '{"relics": ["Stadium Key"]}'::jsonb
      WHERE id = $2
    `, [STADIUM_FOUNDER_TITLE, userId]);

    // 2. Trigger system-wide 'Great Lighting' event
    // Inject 10,000 Power Points (PP) into the Global Table for every tribe
    await client.query(`
      UPDATE tribes 
      SET total_points = total_points + 10000
    `);

    // Activate the 60-minute 'Golden Fire' UI theme state
    if (fastify.redis) {
      await fastify.redis.set('milestone:golden_fire_active', 'true', 'EX', 3600);
    }

    // 3. Record leading tribes in each region and award '25k Pioneer' flair
    const leadingTribes = await client.query(`
      WITH RankedTribes AS (
        SELECT id, region, name,
               ROW_NUMBER() OVER (PARTITION BY region ORDER BY total_points DESC, member_count DESC) as rank
        FROM tribes
        WHERE region IS NOT NULL
      )
      SELECT id, region, name FROM RankedTribes WHERE rank = 1
    `);

    for (const tribe of leadingTribes.rows) {
      // Award flair to the tribe (in metadata)
      await client.query(`
        UPDATE tribes
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('flairs', COALESCE(metadata->'flairs', '[]'::jsonb) || '["25k Pioneer"]'::jsonb)
        WHERE id = $1
      `, [tribe.id]);
      
      fastify.log.info({ tribeId: tribe.id, tribeName: tribe.name, region: tribe.region }, 'Awarded 25k Pioneer flair to leading tribe');
    }

    // 4. Record milestone event for audit
    await client.query(`
      INSERT INTO system_events (event_type, metadata, created_at)
      VALUES ($1, $2, NOW())
    `, ['milestone_25k', JSON.stringify({
      winnerUserId: userId,
      leadingTribes: leadingTribes.rows
    })]);

    await client.query('COMMIT');

    // 5. Automate 'Ares Surge Badge' distribution
    // This could be slow, so we do it in the background or via a bulk insert
    // For now, let's just award it to the current user and trigger a backfill job
    await awardBadge(fastify, userId, ARES_SURGE_ID);
    
    // Trigger backfill in background
    backfillAresSurgeBadges(fastify).catch(err => fastify.log.error(err, 'Error in Ares backfill'));

    // 6. Broadcast event
    // In a real system, we'd send push notifications here
    fastify.log.info('BROADCAST: The Great Lighting has begun! 10,000 PP injected into all tribes. Golden Fire UI active for 60m.');

    if (fastify.relayNamespace) {
      fastify.relayNamespace.emit('milestone:great_lighting', {
        winnerUserId: userId,
        message: 'The Great Lighting has begun! 10,000 PP injected into all tribes. Golden Fire UI active for 60m.',
        duration_minutes: 60
      });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Error triggering 25k milestone');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Backfill Ares Surge Badge for all users who registered before or at the 25k mark
 */
async function backfillAresSurgeBadges(fastify) {
  try {
    const result = await fastify.db.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, created_at
      FROM users
      WHERE created_at <= (SELECT created_at FROM users ORDER BY created_at ASC OFFSET $2 LIMIT 1)
      ON CONFLICT (user_id, achievement_id) DO NOTHING
    `, [ARES_SURGE_ID, MILESTONE_25K - 1]);
    
    fastify.log.info({ count: result.rowCount }, 'Ares Surge Badge backfill completed');
  } catch (err) {
    fastify.log.error(err, 'Failed to backfill Ares Surge Badge');
  }
}

/**
 * Trigger the 50k Milestone Ritual (The Centurion Surge)
 */
export async function trigger50kMilestone(fastify, userId) {
  fastify.log.info({ userId }, '50k Milestone reached! Starting Centurion Surge ritual...');

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Award the 50,000th user rewards
    // 10,000 GT and Centurion Prime title
    await client.query(`
      UPDATE users 
      SET goal_tokens = goal_tokens + 10000,
          title = $1,
          metadata = COALESCE(metadata, '{}'::jsonb) || '{"relics": ["Centurion Prime Shield"]}'::jsonb
      WHERE id = $2
    `, [CENTURION_PRIME_TITLE, userId]);

    // 2. Trigger system-wide 'Centurion Breath' event
    // Inject 25,000 Power Points (PP) into the Global Table for every tribe
    await client.query(`
      UPDATE tribes 
      SET total_points = total_points + 25000
    `);

    // Activate the 120-minute 'Centurion Surge' UI theme state
    if (fastify.redis) {
      await fastify.redis.set('milestone:centurion_surge_active', 'true', 'EX', 7200);
    }

    // 3. Record milestone event for audit
    await client.query(`
      INSERT INTO system_events (event_type, metadata, created_at)
      VALUES ($1, $2, NOW())
    `, ['milestone_50k', JSON.stringify({
      winnerUserId: userId,
      timestamp: new Date().toISOString()
    })]);

    await client.query('COMMIT');

    // 4. Award Centurion Surge Badge to winner
    await awardBadge(fastify, userId, CENTURION_SURGE_ID);
    
    // 5. Trigger backfill in background
    backfillCenturionSurgeBadges(fastify).catch(err => fastify.log.error(err, 'Error in Centurion backfill'));

    // 6. Broadcast event
    if (fastify.relayNamespace) {
      fastify.relayNamespace.emit('milestone:centurion_surge', {
        winnerUserId: userId,
        message: 'The 50,000th Centurion has arrived! 25,000 PP injected into all tribes. Centurion Surge UI active for 120m.',
        duration_minutes: 120
      });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Error triggering 50k milestone');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Backfill Centurion Surge Badge for all users who registered before or at the 50k mark
 */
async function backfillCenturionSurgeBadges(fastify) {
  try {
    const result = await fastify.db.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, created_at
      FROM users
      WHERE created_at <= (SELECT created_at FROM users ORDER BY created_at ASC OFFSET $2 LIMIT 1)
      ON CONFLICT (user_id, achievement_id) DO NOTHING
    `, [CENTURION_SURGE_ID, MILESTONE_50K - 1]);
    
    fastify.log.info({ count: result.rowCount }, 'Centurion Surge Badge backfill completed');
  } catch (err) {
    fastify.log.error(err, 'Failed to backfill Centurion Surge Badge');
  }
}
