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

async function getMetrics() {
  const client = await pool.connect();
  try {
    // 1. Total confirmed signups
    const totalRes = await client.query('SELECT COUNT(*) FROM users');
    console.log('Total Signups:', totalRes.rows[0].count);

    // 2. Breakdown by country (Big 15)
    // I need to check how countries are stored. 
    // Usually tribes have a 'region' or 'country' associated.
    // Let's check tribes table columns.
    const columnsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tribes'");
    const columns = columnsRes.rows.map(r => r.column_name);
    console.log('Tribe Columns:', columns);

    // Assuming tribes have 'region' or 'country' and users are linked to tribes.
    const countryRes = await client.query(`
      SELECT t.region as country, COUNT(u.id) as count
      FROM users u
      JOIN tribes t ON u.tribe_id = t.id
      GROUP BY t.region
      ORDER BY count DESC
    `);
    console.log('Breakdown by Country:', countryRes.rows);

    // 3. Top 5 tribes by Power Points (African Power Table logic)
    // As seen in africanGiantsService.js
    const powerTableRes = await client.query(`
      SELECT name, slug, 
             (COALESCE(waitlist_signups, 0) * 1.0)
             + (COALESCE(avg_fan_iq, 0)::numeric * 0.5)
             + (COALESCE(daily_engagement_points, 0) * 0.3) as power_score
      FROM tribes
      ORDER BY power_score DESC
      LIMIT 5
    `);
    console.log('Top 5 Tribes by Power Points:', powerTableRes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

getMetrics();
