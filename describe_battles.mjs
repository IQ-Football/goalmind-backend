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
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'battles'
    `);
    console.table(res.rows);
  } catch (err) {
    console.error('Error describing table:', err);
  } finally {
    await pool.end();
  }
}
run();
