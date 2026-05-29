import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function del() {
  try {
    await pool.query("DELETE FROM tribe_members WHERE user_id IN (SELECT id FROM users WHERE email = 'test_orp_2@example.com')");
    await pool.query("DELETE FROM users WHERE email = 'test_orp_2@example.com'");
    console.log("User deleted successfully");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
del();
