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
  const cols = [
    { name: 'season_id', sql: "ADD COLUMN IF NOT EXISTS season_id UUID" },
    { name: 'battles_drawn', sql: "ADD COLUMN IF NOT EXISTS battles_drawn INTEGER DEFAULT 0" },
    { name: 'battles_lost', sql: "ADD COLUMN IF NOT EXISTS battles_lost INTEGER DEFAULT 0" },
    { name: 'league_points', sql: "ADD COLUMN IF NOT EXISTS league_points INTEGER DEFAULT 0" },
    { name: 'wins_count', sql: "ADD COLUMN IF NOT EXISTS wins_count INTEGER DEFAULT 0" },
    { name: 'draws_count', sql: "ADD COLUMN IF NOT EXISTS draws_count INTEGER DEFAULT 0" },
    { name: 'losses_count', sql: "ADD COLUMN IF NOT EXISTS losses_count INTEGER DEFAULT 0" },
    { name: 'current_win_streak', sql: "ADD COLUMN IF NOT EXISTS current_win_streak INTEGER DEFAULT 0" },
    { name: 'longest_win_streak', sql: "ADD COLUMN IF NOT EXISTS longest_win_streak INTEGER DEFAULT 0" },
    { name: 'previous_rank', sql: "ADD COLUMN IF NOT EXISTS previous_rank INTEGER" },
  ];

  for (const c of cols) {
    try {
      await pool.query(`ALTER TABLE league_participants ${c.sql}`);
      console.log(`✓ ${c.name} added`);
    } catch (err) {
      if (err.code === '42701') console.log(`○ ${c.name} exists`);
      else console.error(`✗ ${c.name}: ${err.message}`);
    }
  }
  await pool.end();
}
migrate().catch(e => { console.error(e); process.exit(1); });