
import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
});

async function check() {
  try {
    const res = await pool.query('SELECT COUNT(*) FROM questions');
    console.log('Question Count:', res.rows[0].count);
    
    const tribes = await pool.query('SELECT COUNT(*) FROM tribes');
    console.log('Tribe Count:', tribes.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
