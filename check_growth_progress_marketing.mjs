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
  const result = await pool.query(`
    SELECT referred_by, COUNT(*) as count
    FROM users
    WHERE referred_by IS NOT NULL
    GROUP BY referred_by
  `);
  console.log('Referral Hits:');
  console.log(JSON.stringify(result.rows, null, 2));

  const tribes = await pool.query(`
    SELECT t.name, COUNT(u.id) as signups
    FROM tribes t
    LEFT JOIN users u ON t.id = u.tribe_id
    GROUP BY t.name
    HAVING COUNT(u.id) > 0
    ORDER BY signups DESC
  `);
  console.log('\nTribe Counts:');
  console.log(JSON.stringify(tribes.rows, null, 2));

  const recent = await pool.query(`
    SELECT COUNT(*) as count
    FROM users
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `);
  console.log('\nRecent Signups (24h):', recent.rows[0].count);

  await pool.end();
}
check().catch(e => { console.error(e.message); process.exit(1); });
