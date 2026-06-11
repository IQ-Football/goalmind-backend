import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

const WYDAD_TRIBE_ID = 'fb27a4d2-79a2-43f4-8097-a8c1f517b354';
const FOUNDING_COMMANDER_BADGE_ID = '550e8400-e29b-41d4-a716-446655440008';

async function processWydadMilestone() {
  const client = await pool.connect();
  try {
    console.log("--- WYDAD CASABLANCA 1k TRIBE MILESTONE REWARDS ---");
    await client.query('BEGIN');

    // 0. Ensure 'Founding Commander' badge exists
    await client.query(`
      INSERT INTO achievements (id, name, description, criteria, tier, slug)
      VALUES ($1, 'Founding Commander', 'Awarded to the top referrers of the Wydad Casablanca tribe during their 1k milestone.', '{"type": "manual"}', 'Legendary', 'founding_commander')
      ON CONFLICT (id) DO NOTHING
    `, [FOUNDING_COMMANDER_BADGE_ID]);

    // 1. Update tribe status to Imperial
    const tribeUpdate = await client.query(`
      UPDATE tribes 
      SET is_super_tribe = true 
      WHERE id = $1
    `, [WYDAD_TRIBE_ID]);
    console.log(`Updated Wydad tribe status to Imperial (is_super_tribe = true). Rows affected: ${tribeUpdate.rowCount}`);

    // 2. Identify and reward 'Power Hour' users (members 970-1000)
    const powerHourUsers = await client.query(`
      WITH ranked_members AS (
        SELECT u.id, u.username,
               ROW_NUMBER() OVER (ORDER BY COALESCE(tm.joined_at, u.created_at) ASC) as join_rank
        FROM users u
        LEFT JOIN tribe_members tm ON u.id = tm.user_id
        WHERE u.tribe_id = $1
      )
      SELECT id, username FROM ranked_members WHERE join_rank BETWEEN 970 AND 1000
    `, [WYDAD_TRIBE_ID]);

    console.log(`Found ${powerHourUsers.rows.length} Power Hour users (ranks 970-1000).`);

    for (const user of powerHourUsers.rows) {
      // Award 1,500 GoalTokens (1,000 additional + 500 assumed base)
      await client.query(`
        UPDATE users 
        SET goal_tokens = goal_tokens + 1500 
        WHERE id = $1
      `, [user.id]);
      
      console.log(`AWARDED: 1,500 GoalTokens to ${user.username}`);

      // Record event
      await client.query(`
        INSERT INTO system_events (event_type, metadata, created_at)
        VALUES ($1, $2, NOW())
      `, ['tribe_power_hour_reward', JSON.stringify({ userId: user.id, username: user.username, tribeId: WYDAD_TRIBE_ID, reward: '1500 GT' })]);
    }

    // 3. Award 'Founding Commander' badge to top 5 referrers in Wydad
    const topReferrers = await client.query(`
      SELECT u.id, u.username, COUNT(r.id) as referral_count
      FROM users u
      JOIN referrals r ON u.id = r.referrer_id
      WHERE u.tribe_id = $1
      GROUP BY u.id, u.username
      ORDER BY referral_count DESC
      LIMIT 5
    `, [WYDAD_TRIBE_ID]);

    console.log(`Found ${topReferrers.rows.length} qualifying referrers in Wydad.`);

    for (const referrer of topReferrers.rows) {
      const achRes = await client.query(`
        INSERT INTO user_achievements (user_id, achievement_id, earned_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, achievement_id) DO NOTHING
        RETURNING *
      `, [referrer.id, FOUNDING_COMMANDER_BADGE_ID]);

      if (achRes.rows.length > 0) {
        console.log(`AWARDED: Founding Commander Badge to referrer ${referrer.username} (${referrer.referral_count} referrals)`);
        
        // Record event
        await client.query(`
          INSERT INTO system_events (event_type, metadata, created_at)
          VALUES ($1, $2, NOW())
        `, ['founding_commander_awarded', JSON.stringify({ userId: referrer.id, username: referrer.username, tribeId: WYDAD_TRIBE_ID, referralCount: referrer.referral_count })]);
      }
    }

    await client.query('COMMIT');
    console.log("--- WYDAD MILESTONE PROCESSING COMPLETE ---");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error processing Wydad milestone:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

processWydadMilestone();
