
import pg from 'pg';
import config from '../src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Adding cohort column to users table...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cohort VARCHAR(50);
    `);

    console.log('Tagging the first 500 users as vanguard_500...');
    // Tag first 500 by created_at
    await client.query(`
      WITH first_500 AS (
        SELECT id FROM users 
        ORDER BY created_at ASC 
        LIMIT 500
      )
      UPDATE users 
      SET cohort = 'vanguard_500'
      WHERE id IN (SELECT id FROM first_500);
    `);

    await client.query('COMMIT');
    console.log('Migration and initial tagging complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
