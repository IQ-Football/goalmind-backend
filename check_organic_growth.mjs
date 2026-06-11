import pkg from 'pg';
const { Pool } = pkg;
import config from './src/config.js';

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  try {
    const res = await pool.query("SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@test.com'");
    console.log(`Organic User Count: ${res.rows[0].count}`);
    
    const recentOrganic = await pool.query(`
      SELECT t.name, COUNT(u.id) as recent_organic_signups
      FROM users u
      JOIN tribes t ON u.tribe_id = t.id
      WHERE u.created_at >= '2026-06-05' AND u.email NOT LIKE '%@test.com'
      GROUP BY t.name
      ORDER BY recent_organic_signups DESC
    `);
    console.log("Recent Organic Signup Distribution:", JSON.stringify(recentOrganic.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
