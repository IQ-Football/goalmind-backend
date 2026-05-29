
import { FOUNDING_CAPTAIN_ID as TC_ID } from './achievementService.js';

const VETERAN_BADGE_ID = '550e8400-e29b-41d4-a716-446655440004'; // Placeholder or create in DB

/**
 * Process Tribe Commander maintenance at the end of a season/month.
 */
export async function processTCMaintenance(fastify) {
  fastify.log.info('Running Tribe Commander maintenance check...');

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Find all current Tribe Commanders
    const tcResult = await client.query(
      `SELECT user_id FROM user_achievements WHERE achievement_id = $1`,
      [TC_ID]
    );

    for (const tc of tcResult.rows) {
      const userId = tc.user_id;

      // 2. Check CP contribution in the last 30 days
      const cpResult = await client.query(
        `SELECT SUM(points_earned) as total_cp 
         FROM (
           SELECT player1_points as points_earned FROM battle_rounds br JOIN battles b ON br.battle_id = b.id WHERE b.player1_id = $1 AND br.created_at > NOW() - INTERVAL '30 days'
           UNION ALL
           SELECT player2_points as points_earned FROM battle_rounds br JOIN battles b ON br.battle_id = b.id WHERE b.player2_id = $1 AND br.created_at > NOW() - INTERVAL '30 days'
         ) as contributions`,
        [userId]
      );
      const totalCP = parseInt(cpResult.rows[0].total_cp || 0);

      // 3. Check recruits in the last 30 days
      const recruitResult = await client.query(
        `SELECT COUNT(*) as recruit_count 
         FROM referrals 
         WHERE referrer_id = $1 AND status = 'joined' AND created_at > NOW() - INTERVAL '30 days'`,
        [userId]
      );
      const recruitCount = parseInt(recruitResult.rows[0].recruit_count || 0);

      // 4. Maintenance check
      const maintainsStatus = totalCP >= 5000 || recruitCount >= 5;

      if (!maintainsStatus) {
        fastify.log.info({ userId, totalCP, recruitCount }, 'User failed TC maintenance. Relegating to Veteran.');

        // Remove TC badge
        await client.query(
          'DELETE FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
          [userId, TC_ID]
        );

        // Award Veteran badge
        await client.query(
          `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [userId, VETERAN_BADGE_ID]
        );

        // Update tribe_members metadata if needed
        await client.query(
          `UPDATE tribe_members 
           SET tier = 'Ultra', 
               metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{badges,former_commander}', '"Veteran"'::jsonb)
           WHERE user_id = $1`,
          [userId]
        );
      }
    }

    await client.query('COMMIT');
    fastify.log.info('TC maintenance check complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err }, 'Error during TC maintenance check');
  } finally {
    client.release();
  }
}
