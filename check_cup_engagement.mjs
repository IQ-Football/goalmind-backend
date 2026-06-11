import config from './src/config.js';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function run() {
  console.log('--- Continental Cup Engagement Check ---');
  
  try {
    const seasonsRes = await pool.query('SELECT * FROM continental_cup_seasons');
    console.log('Seasons:', seasonsRes.rows.length);
    if (seasonsRes.rows.length > 0) {
        console.log('Latest Season:', seasonsRes.rows[0]);
    }

    const rankingsRes = await pool.query('SELECT COUNT(*) FROM continental_cup_tribe_rankings');
    console.log('Total Tribe Rankings in Cup:', rankingsRes.rows[0].count);

    // Check if there are any "World Cup" specific achievements or badges
    const badgesRes = await pool.query("SELECT COUNT(*) FROM user_achievements WHERE achievement_id IN (SELECT id FROM achievements WHERE name ILIKE '%World Cup%' OR name ILIKE '%Continental Cup%')");
    console.log('Users with Cup/Tournament Badges:', badgesRes.rows[0].count);

    // Check battle counts for tournament types if they exist
    try {
        const battleTypesRes = await pool.query("SELECT battle_type, COUNT(*) FROM battles GROUP BY battle_type");
        console.log('Battle Types Distribution:');
        console.table(battleTypesRes.rows);
    } catch (e) {
        console.log('Could not fetch battle types distribution');
    }

  } catch (e) {
    console.error('Error fetching data:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
