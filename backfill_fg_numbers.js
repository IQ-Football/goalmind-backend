
import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  try {
    const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';
    
    // Get all tribes
    const tribesRes = await pool.query('SELECT id, name FROM tribes');
    const tribes = tribesRes.rows;

    for (const tribe of tribes) {
      console.log(`Processing tribe: ${tribe.name} (${tribe.id})`);
      
      // Get users in this tribe with the FG badge, ordered by earned_at
      const usersRes = await pool.query(`
        SELECT ua.user_id, ua.earned_at
        FROM user_achievements ua
        JOIN users u ON ua.user_id = u.id
        WHERE ua.achievement_id = $1 AND u.tribe_id = $2
        ORDER BY ua.earned_at ASC
      `, [FOUNDING_GENERAL_ID, tribe.id]);

      const users = usersRes.rows;
      console.log(`Found ${users.length} Founding Generals`);

      for (let i = 0; i < users.length; i++) {
        const signupNumber = i + 1;
        const userId = users[i].user_id;
        
        console.log(`Assigning #${signupNumber} to user ${userId}`);

        // Update tribe_members metadata
        const badgeData = {
          asset: '/home/team/shared/GoalMind/assets/badges/founding_general.png',
          signup_number: signupNumber,
          flair_name: 'Ancient Scroll'
        };

        await pool.query(`
          UPDATE tribe_members
          SET is_founding_general = true,
              metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb), 
                '{badges,founding_general}', 
                $1::jsonb
              )
          WHERE user_id = $2
        `, [JSON.stringify(badgeData), userId]);

        // Also update users metadata for redundancy/profile access
        await pool.query(`
          UPDATE users
          SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb), 
                '{badges,founding_general}', 
                $1::jsonb
              )
          WHERE id = $2
        `, [JSON.stringify(badgeData), userId]);
      }
    }

    console.log('Backfill complete!');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
