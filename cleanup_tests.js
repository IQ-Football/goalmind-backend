import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function cleanup() {
  try {
    await pool.query("DELETE FROM referrals WHERE recruit_id IN (SELECT id FROM users WHERE email IN ('test_orp_2@example.com', 'test_orp@example.com', 'partner_test_orp@example.com'))");
    await pool.query("DELETE FROM tribe_members WHERE user_id IN (SELECT id FROM users WHERE email IN ('test_orp_2@example.com', 'test_orp@example.com', 'partner_test_orp@example.com'))");
    await pool.query("DELETE FROM users WHERE email IN ('test_orp_2@example.com', 'test_orp@example.com', 'partner_test_orp@example.com')");
    await pool.query("UPDATE tribes SET waitlist_signups = GREATEST(0, waitlist_signups - 3), member_count = GREATEST(0, member_count - 3) WHERE id = '1f37663a-af6f-43a3-8aff-b308b78bb8dd'");
    console.log("Cleanup successful");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
cleanup();
