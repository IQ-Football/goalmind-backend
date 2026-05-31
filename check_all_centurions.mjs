import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const FOUNDING_CENTURION_ID = '660e8400-e29b-41d4-a716-446655440001';

async function run() {
  try {
    const res = await pool.query(`
      SELECT t.name, t.slug, t.member_count, 
             (SELECT COUNT(*) FROM user_achievements ua 
              JOIN users u ON ua.user_id = u.id 
              WHERE u.tribe_id = t.id AND ua.achievement_id = $1) as centurion_count
      FROM tribes t
      WHERE t.member_count > 10
      ORDER BY t.member_count DESC
    `, [FOUNDING_CENTURION_ID]);
    
    console.log("Tribes with > 10 members and their Centurion counts:");
    // Calculate expected centurions: min(member_count - 10, 90)
    const processed = res.rows.map(r => ({
        ...r,
        expected: Math.min(parseInt(r.member_count) - 10, 90)
    }));
    
    const missing = processed.filter(r => parseInt(r.centurion_count) < r.expected);
    
    if (missing.length > 0) {
      console.log("\nTribes missing Centurion awards:");
      console.table(missing);
    } else {
      console.log("\nAll eligible tribes have correct Centurion counts.");
      console.table(processed.slice(0, 25)); // show top 25
    }
  } catch (err) {
    console.error('Check error:', err);
  } finally {
    await pool.end();
  }
}
run();

async function printTotal() {
  const pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password
  });
  const total = await pool.query("SELECT COUNT(*) FROM user_achievements WHERE achievement_id = '660e8400-e29b-41d4-a716-446655440001'");
  console.log("\\nTotal Founding Centurion badges awarded:", total.rows[0].count);
  await pool.end();
}
printTotal();
