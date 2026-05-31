import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT t.name, t.slug, COUNT(ua.user_id) as centurion_count 
      FROM tribes t
      JOIN users u ON t.id = u.tribe_id
      JOIN user_achievements ua ON u.id = ua.user_id
      WHERE ua.achievement_id = '660e8400-e29b-41d4-a716-446655440001'
      AND t.slug IN ('nigeria', 'ghana', 'morocco', 'wits-clever-boys', 'uct-ikey-tigers', 'tripoli', 'esperance-de-tunis', 'nkana-fc')
      GROUP BY t.name, t.slug
      ORDER BY centurion_count DESC
    `);
    console.table(res.rows);
  } catch (err) {
    console.error('Verification error:', err);
  } finally {
    await pool.end();
  }
}
run();
