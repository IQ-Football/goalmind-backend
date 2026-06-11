
import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function process50kMilestone() {
  const client = await pool.connect();
  try {
    console.log("--- 50k MILESTONE REWARDS PROCESSING ---");
    await client.query('BEGIN');

    // 0. Ensure badges exist
    const centurionSurgeBadgeId = '770e8400-e29b-41d4-a716-446655440003';
    const tribalVeteranBadgeId = '770e8400-e29b-41d4-a716-446655440004';
    const tribeCommanderBadgeId = '550e8400-e29b-41d4-a716-446655440005';

    await client.query(`
      INSERT INTO achievements (id, name, description, criteria, tier)
      VALUES ($1, 'Centurion Surge', 'Awarded to the second cohort of 25,000 users during the surge to 50k.', '{"type": "signup_number", "range": [25001, 50000]}', 'Epic')
      ON CONFLICT (id) DO NOTHING
    `, [centurionSurgeBadgeId]);

    await client.query(`
      INSERT INTO achievements (id, name, description, criteria, tier)
      VALUES ($1, 'Tribal Veteran', 'Awarded to the pioneers who joined before the 25k milestone.', '{"type": "signup_number", "range": [1, 25000]}', 'Epic')
      ON CONFLICT (id) DO NOTHING
    `, [tribalVeteranBadgeId]);

    // 1. Identify the 50,000th user (Winner)
    const winnerRes = await client.query('SELECT * FROM users ORDER BY created_at ASC LIMIT 1 OFFSET 49999');
    const winner = winnerRes.rows[0];

    if (winner) {
      console.log(`WINNER (50,000th) identified: ${winner.username} (${winner.id})`);
      
      // Award 10,000 GoalTokens and "Centurion Legend" title
      await client.query('UPDATE users SET goal_tokens = goal_tokens + 10000, title = $1 WHERE id = $2', ['Centurion Legend', winner.id]);
      console.log(`AWARDED: 10,000 GoalTokens and 'Centurion Legend' title to ${winner.username}`);
    } else {
      console.log("50,000th user not found. Milestone likely not reached yet.");
    }

    // 2. Award 'Centurion Surge' Badge to users 25,001 to 50,000
    const surgeRes = await client.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, created_at FROM (
        SELECT id, created_at FROM users ORDER BY created_at ASC LIMIT 25000 OFFSET 25000
      ) as cohort
      ON CONFLICT (user_id, achievement_id) DO NOTHING
    `, [centurionSurgeBadgeId]);
    console.log(`AWARDED: Centurion Surge Badge to ${surgeRes.rowCount} users.`);

    // 3. Award 'Tribal Veteran' Badge to users before 25,001
    const veteranBadgeRes = await client.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, created_at FROM (
        SELECT id, created_at FROM users ORDER BY created_at ASC LIMIT 25000
      ) as pioneers
      ON CONFLICT (user_id, achievement_id) DO NOTHING
    `, [tribalVeteranBadgeId]);
    console.log(`AWARDED: Tribal Veteran Badge to ${veteranBadgeRes.rowCount} users.`);

    // 4. Award 'Pre-50k Veteran' Title to users before 25,001
    const veteranTitleRes = await client.query(`
      UPDATE users 
      SET title = 'Pre-50k Veteran'
      WHERE id IN (
        SELECT id FROM users ORDER BY created_at ASC LIMIT 25000
      ) AND (title IS NULL OR (title != 'Stadium Founder' AND title != 'Centurion Legend'))
    `);
    console.log(`AWARDED: 'Pre-50k Veteran' title to ${veteranTitleRes.rowCount} users.`);

    // 5. Monitor for 'Imperial Breach' (1,000 members per tribe)
    const tribesRes = await client.query('SELECT id, name FROM tribes');
    for (const tribe of tribesRes.rows) {
      const memberCountRes = await client.query('SELECT COUNT(*) FROM users WHERE tribe_id = $1', [tribe.id]);
      const count = parseInt(memberCountRes.rows[0].count);
      
      if (count >= 1000) {
        console.log(`TRIBE MILESTONE: ${tribe.name} reached ${count} members!`);
        
        // Identify Captain (First member of the tribe)
        const captainRes = await client.query(`
          SELECT u.id, u.username FROM users u
          LEFT JOIN tribe_members tm ON u.id = tm.user_id
          WHERE u.tribe_id = $1 
          ORDER BY COALESCE(tm.joined_at, u.created_at) ASC 
          LIMIT 1
        `, [tribe.id]);
        
        const captain = captainRes.rows[0];
        
        if (captain) {
          // Award 'Tribe Commander' badge
          const cmdRes = await client.query(`
            INSERT INTO user_achievements (user_id, achievement_id, earned_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id, achievement_id) DO NOTHING
            RETURNING *
          `, [captain.id, tribeCommanderBadgeId]);
          
          if (cmdRes.rows.length > 0) {
            console.log(`AWARDED: Tribe Commander Badge to ${captain.username} (Captain of ${tribe.name})`);
            
            // Award title 'Imperial Commander'
            await client.query("UPDATE users SET title = 'Imperial Commander' WHERE id = $1", [captain.id]);
            
            // Record event
            await client.query(`
              INSERT INTO system_events (event_type, metadata, created_at)
              VALUES ($1, $2, NOW())
            `, ['TRIBE_COMMANDER_CROWNED', JSON.stringify({ tribe: tribe.name, captain: captain.username, count })]);
          }
        }
      }
    }

    // 6. Record milestone completion event
    await client.query(`
      INSERT INTO system_events (event_type, metadata, created_at)
      VALUES ($1, $2, NOW())
    `, ['milestone_50k_complete', JSON.stringify({ 
        winnerId: winner?.id, 
        timestamp: new Date().toISOString() 
    })]);

    await client.query('COMMIT');
    console.log("--- 50k PROCESSING COMPLETE ---");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error processing 50k milestone:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

process50kMilestone();
