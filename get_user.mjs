import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function get(idOrEmail) {
  try {
    const res = await pool.query("SELECT id, email, username, tribe_id, metadata FROM users WHERE id = $1 OR email = $2", [idOrEmail, idOrEmail]);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
const val = process.argv[2];
if (!val) {
  console.error("Usage: node get_user.mjs <idOrEmail>");
  process.exit(1);
}
get(val);
