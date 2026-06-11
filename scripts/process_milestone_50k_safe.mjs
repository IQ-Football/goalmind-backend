import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

/**
 * process_milestone_50k_safe.mjs
 * Optimized and Idempotent reward processing for the 50k Milestone Surge.
 */
async function process50kMilestone() {
  const client = await pool.connect();
  try {
    console.log("--- 50k MILESTONE REWARDS PROCESSING (v2 - SAFE) ---");

    // 0. Ensure badges exist
    const centurionSurgeBadgeId = '770e8400-e29b-41d4-a716-446655440003';
    await client.query(`
      INSERT INTO achievements (id, name, description, criteria, tier)
      VALUES ($1, 'Centurion Surge', 'Awarded to the second cohort of 25,000 users during the surge to 50k.', '{"type": "signup_number", "range": [25001, 50000]}', 'Epic')
      ON CONFLICT (id) DO NOTHING
    `, [centurionSurgeBadgeId]);

    // 1. Check if milestone already fully processed for the winner
    const existingEvent = await client.query(
      "SELECT metadata FROM system_events WHERE event_type = 'milestone_50k_complete' AND metadata->>'winnerId' IS NOT NULL"
    );

    if (existingEvent.rows.length > 0) {
      console.log("Milestone 50k already fully processed. Skipping winner award.");
    } else {
      // Identify the 50,000th user (Winner)
      const winnerRes = await client.query('SELECT * FROM users ORDER BY created_at ASC LIMIT 1 OFFSET 49999');
      const winner = winnerRes.rows[0];

      if (winner) {
        console.log(`WINNER (50,000th) identified: ${winner.username} (${winner.id})`);
        
        // Atomically award tokens and title only if not already done
        const updateRes = await client.query(
          "UPDATE users SET goal_tokens = goal_tokens + 10000, title = 'Centurion Legend' WHERE id = $1 AND title != 'Centurion Legend'",
          [winner.id]
        );

        if (updateRes.rowCount > 0) {
          console.log(`AWARDED: 10,000 GoalTokens and 'Centurion Legend' title to ${winner.username}`);
          
          await client.query(`
            INSERT INTO system_events (event_type, metadata, created_at)
            VALUES ($1, $2, NOW())
          `, ['milestone_50k_complete', JSON.stringify({
              winnerId: winner.id,
              username: winner.username,
              timestamp: new Date().toISOString()
          })]);
        } else {
          console.log(`${winner.username} already has the title. Skipping.`);
        }
      } else {
        console.log("50,000th user not found. Milestone likely not reached yet.");
      }
    }

    // 2. Award 'Centurion Surge' Badge to users 25,001 to 50,000 (Idempotent via ON CONFLICT)
    const surgeRes = await client.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, NOW() FROM (
        SELECT id FROM users ORDER BY created_at ASC LIMIT 25000 OFFSET 25000
      ) as cohort
      ON CONFLICT (user_id, achievement_id) DO NOTHING
    `, [centurionSurgeBadgeId]);
    console.log(`AWARDED: Centurion Surge Badge to ${surgeRes.rowCount} NEW users.`);

    // 3. Award 'Pre-50k Veteran' Title to users before 25,001
    // Filter to avoid overwriting special titles or repeating unnecessarily
    const veteranRes = await client.query(`
      UPDATE users
      SET title = 'Pre-50k Veteran'
      WHERE id IN (
        SELECT id FROM users ORDER BY created_at ASC LIMIT 25000
      ) AND (title IS NULL OR (title != 'Stadium Founder' AND title != 'Pre-50k Veteran'))
    `);
    console.log(`AWARDED: 'Pre-50k Veteran' title to ${veteranRes.rowCount} NEW users.`);

    console.log("--- 50k PROCESSING COMPLETE ---");
  } catch (err) {
    console.error('Error processing 50k milestone:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

process50kMilestone();
