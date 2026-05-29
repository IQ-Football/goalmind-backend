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

async function migrate() {
  const migrations = [
    { col: 'contribution_points', sql: "ADD COLUMN IF NOT EXISTS contribution_points INTEGER DEFAULT 0" },
    { col: 'decay_immunity_days', sql: "ADD COLUMN IF NOT EXISTS decay_immunity_days INTEGER DEFAULT 0" },
    { col: 'blitz_buffer_active', sql: "ADD COLUMN IF NOT EXISTS blitz_buffer_active BOOLEAN DEFAULT false" },
  ];
  
  for (const m of migrations) {
    try {
      await pool.query(`ALTER TABLE users ${m.sql}`);
      console.log(`✓ ${m.col} added`);
    } catch (err) {
      if (err.code === '42701') { // duplicate_column
        console.log(`○ ${m.col} already exists`);
      } else {
        console.error(`✗ ${m.col}: ${err.message}`);
      }
    }
  }
  
  await pool.end();
}
migrate().catch(e => { console.error(e); process.exit(1); });