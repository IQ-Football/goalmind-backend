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

async function check() {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log(JSON.stringify(tables.rows.map(r => r.table_name), null, 2));
  
  // Check badges table
  const badges = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'badges' ORDER BY ordinal_position");
  console.log('BADGES:', JSON.stringify(badges.rows.map(r => r.column_name)));
  
  // Check user_stats or user_status
  const userStats = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'user_stats' ORDER BY ordinal_position");
  console.log('USER_STATS:', JSON.stringify(userStats.rows.map(r => r.column_name)));
  
  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });