
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'goalmind',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function check() {
  try {
    const userCount = await pool.query('SELECT count(*) FROM users');
    console.log(`Total Users: ${userCount.rows[0].count}`);

    const tribeStats = await pool.query(`
      SELECT t.name, count(u.id) as signups 
      FROM tribes t 
      LEFT JOIN users u ON t.id = u.tribe_id 
      GROUP BY t.name 
      ORDER BY signups DESC
    `);
    console.log('Signup Breakdown per Tribe:');
    tribeStats.rows.forEach(row => {
      console.log(`- ${row.name}: ${row.signups}`);
    });

  } catch (err) {
    console.error('Database Error:', err.message);
  } finally {
    await pool.end();
  }
}

check();
