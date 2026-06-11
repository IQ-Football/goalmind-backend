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

async function findMismatches() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT u.id, u.username, u.tribe_id as user_tribe, tm.tribe_id as member_tribe
      FROM users u
      LEFT JOIN tribe_members tm ON u.id = tm.user_id
      WHERE u.tribe_id IS NOT NULL 
      AND (tm.tribe_id IS NULL OR tm.tribe_id != u.tribe_id)
      LIMIT 10
    `);
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('Mismatch check failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

findMismatches();
