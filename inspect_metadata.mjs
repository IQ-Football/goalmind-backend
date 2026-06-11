import pg from 'pg';
import config from './src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function inspectMetadata() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT username, tribe_id, metadata FROM users WHERE metadata IS NOT NULL LIMIT 10');
    console.log(JSON.stringify(res.rows, null, 2));
    
    const sample = await client.query('SELECT username, tribe_id, metadata FROM users ORDER BY created_at DESC LIMIT 5');
    console.log("Latest users:");
    console.log(JSON.stringify(sample.rows, null, 2));

  } catch (err) {
    console.error('Inspection failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

inspectMetadata();
