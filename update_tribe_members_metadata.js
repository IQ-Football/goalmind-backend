
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
    console.log('Adding metadata column to tribe_members...');
    await pool.query('ALTER TABLE tribe_members ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT \'{}\'');
    
    console.log('Populating metadata for special statuses...');
    // This is optional but good for "pointing to new asset paths" in the database
    await pool.query(`
      UPDATE tribe_members 
      SET metadata = jsonb_build_object(
        'badges', jsonb_build_object(
          'zero_breaker', CASE WHEN is_zero_breaker THEN '/assets/badges/tribal_spark.png' ELSE NULL END,
          'founding_general', CASE WHEN is_founding_general THEN '/assets/badges/founding_general.png' ELSE NULL END,
          'vanguard_100', CASE WHEN is_vanguard_100 THEN '/assets/badges/founding_pro.png' ELSE NULL END
        )
      )
      WHERE is_zero_breaker = true OR is_founding_general = true OR is_vanguard_100 = true
    `);

    console.log('Metadata update complete.');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
