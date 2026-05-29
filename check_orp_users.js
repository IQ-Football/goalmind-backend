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
    const res = await pool.query("SELECT email, username, referred_by FROM users WHERE tribe_id = '1f37663a-af6f-43a3-8aff-b308b78bb8dd'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
check();
