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
    const res = await pool.query("SELECT id, email, username, tribe_id, referral_code FROM users WHERE email = 'test_orp@example.com'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
check();
