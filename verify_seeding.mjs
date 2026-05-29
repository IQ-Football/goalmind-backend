import { Pool } from 'pg';
import config from './src/config.js';

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

async function verify() {
  try {
    const res = await pool.query(`
      SELECT l.name, count(*) 
      FROM league_participants lp 
      JOIN leagues l ON lp.league_id = l.id 
      GROUP BY l.name;
    `);
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

verify();
