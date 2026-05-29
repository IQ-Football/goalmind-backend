import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function check() {
  try {
    const res = await pool.query(`
      SELECT t.name, COUNT(u.id) as signups
      FROM tribes t
      LEFT JOIN users u ON u.tribe_id = t.id
      GROUP BY t.id, t.name
      ORDER BY signups DESC, t.name ASC
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
check();
