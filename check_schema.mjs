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
  console.log('Connecting to:', config.database.name, 'on', config.database.host);
  try {
    const result = await pool.query("SELECT * FROM achievements WHERE id = '550e8400-e29b-41d4-a716-446655440000'");
    console.log('Found Founding General:', JSON.stringify(result.rows, null, 2));
  } catch (e) {
    console.error('Error querying achievements:', e.message);
  }
  const result = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_achievements'");
  console.log('user_achievements schema:', JSON.stringify(result.rows, null, 2));
  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });
