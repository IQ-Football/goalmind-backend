
import pg from 'pg';
import config from '../src/config.js';
import { awardFoundingGeneral, awardFoundingCenturion, FOUNDING_GENERAL_ID, FOUNDING_CENTURION_ID, FOUNDING_THRESHOLD, CENTURION_THRESHOLD } from '../src/services/achievementService.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const fastify = {
  db: pool,
  log: console
};

async function run() {
  console.log('Starting Tribal Prestige Repair Audit...');
  
  const tribes = await pool.query('SELECT id, name FROM tribes');
  
  for (const tribe of tribes.rows) {
    console.log(`\nAuditing tribe: ${tribe.name} (${tribe.id})`);
    
    // Get all members ordered by FIFO join time
    const members = await pool.query(
      `SELECT u.id, u.email, COALESCE(tm.joined_at, u.created_at) as joined_at
       FROM users u
       LEFT JOIN tribe_members tm ON u.id = tm.user_id
       WHERE u.tribe_id = $1
       ORDER BY joined_at ASC`,
      [tribe.id]
    );

    console.log(`Found ${members.rows.length} total members.`);

    for (let i = 0; i < members.rows.length; i++) {
      const user = members.rows[i];
      const rank = i + 1;
      
      if (rank <= FOUNDING_THRESHOLD) {
        // Should be a Founding General
        const res = await awardFoundingGeneral(fastify, user.id, true, rank);
        if (res.success) {
          console.log(`[Rank ${rank}] Awarded Founding General to ${user.email || user.id}`);
        }
      } else if (rank <= CENTURION_THRESHOLD) {
        // Should be a Founding Centurion
        const res = await awardFoundingCenturion(fastify, user.id, true);
        if (res.success) {
          console.log(`[Rank ${rank}] Awarded Founding Centurion to ${user.email || user.id}`);
        }
      } else {
        // Should NOT have these badges
        const deleteRes = await pool.query(
          'DELETE FROM user_achievements WHERE user_id = $1 AND achievement_id IN ($2, $3)',
          [user.id, FOUNDING_GENERAL_ID, FOUNDING_CENTURION_ID]
        );
        if (deleteRes.rowCount > 0) {
            console.log(`[Rank ${rank}] Removed excess prestige badges from ${user.email || user.id}`);
            // Also clean up metadata
            await pool.query("UPDATE users SET metadata = metadata - 'founding_general' - 'founding_centurion' WHERE id = $1", [user.id]);
            await pool.query("UPDATE tribe_members SET metadata = metadata - 'founding_general' - 'founding_centurion', is_founding_general = false WHERE user_id = $1", [user.id]);
        }
      }
    }
  }

  console.log('\nTribal Prestige Repair Audit Complete!');
  await pool.end();
}

run().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
