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
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'battles'
    `);
    console.table(res.rows);
  } catch (err) {
    console.error('Error listing indexes:', err);
  } finally {
    await pool.end();
  }
}
run();
