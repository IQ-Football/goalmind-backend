import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function check(userId) {
  try {
    const res = await pool.query("SELECT * FROM user_achievements WHERE user_id = $1", [userId]);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node check_user_badges.js <userId>");
  process.exit(1);
}
check(userId);
