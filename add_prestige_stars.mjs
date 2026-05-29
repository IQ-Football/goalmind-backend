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

pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS prestige_stars INTEGER DEFAULT 0")
  .then(() => console.log('prestige_stars added'))
  .catch(e => console.log('Note:', e.message))
  .finally(() => pool.end());