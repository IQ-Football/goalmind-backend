import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;

async function checkFinalStats() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  });

  try {
    console.log('Final Verification Stats:');
    
    const cohorts = await pool.query('SELECT cohort, count(*) FROM users GROUP BY cohort ORDER BY count(*) DESC');
    console.log('\nCohort Distribution:');
    console.table(cohorts.rows);

    const badges = await pool.query(`
      SELECT a.name, count(ua.user_id) 
      FROM user_achievements ua 
      JOIN achievements a ON ua.achievement_id = a.id 
      WHERE a.id IN ('770e8400-e29b-41d4-a716-446655440001', '770e8400-e29b-41d4-a716-446655440002', '770e8400-e29b-41d4-a716-446655440003')
      GROUP BY a.name
    `);
    console.log('\nSurge Badge Distribution:');
    console.table(badges.rows);

    await pool.end();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkFinalStats();
