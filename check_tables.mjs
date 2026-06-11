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
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name IN ('tribes', 'tribal_vault_ledger')
    `);
    console.table(res.rows);
    
    const cols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tribes' AND column_name = 'vault_balance'
    `);
    console.table(cols.rows);
  } catch (err) {
    console.error('Error checking tables:', err);
  } finally {
    await pool.end();
  }
}
run();
