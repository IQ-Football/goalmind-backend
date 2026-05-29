import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function apply() {
  try {
    await pool.query("ALTER TABLE referrals ADD CONSTRAINT referrals_recruit_id_unique UNIQUE (recruit_id)");
    console.log("Constraint added successfully");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
apply();
