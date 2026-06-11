import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;

async function backfillCohorts() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  });

  try {
    console.log('Starting cohort backfill...');
    
    // We update cohorts based on creation order
    const query = `
      WITH ranked_users AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as signup_number
        FROM users
      )
      UPDATE users
      SET cohort = CASE 
        WHEN ru.signup_number <= 500 THEN 'vanguard_500'
        WHEN ru.signup_number <= 25000 THEN 'founding_centurion'
        WHEN ru.signup_number <= 30000 THEN 'ares_surge'
        WHEN ru.signup_number <= 50000 THEN 'elite_centurion'
        ELSE 'standard'
      END
      FROM ranked_users ru
      WHERE users.id = ru.id
      AND (users.cohort IS NULL OR users.cohort = 'standard')
    `;

    const res = await pool.query(query);
    console.log(`Successfully updated ${res.rowCount} users.`);
    
    const stats = await pool.query('SELECT cohort, count(*) FROM users GROUP BY cohort ORDER BY count(*) DESC');
    console.log('Final Cohort Distribution:');
    console.table(stats.rows);

    await pool.end();
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
}

backfillCohorts();
