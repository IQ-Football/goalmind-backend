import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function run() {
  try {
    await client.connect();
    const res = await client.query('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 10;');
    console.log(JSON.stringify(res.rows, null, 2));
    const countRes = await client.query('SELECT COUNT(*) FROM waitlist;');
    console.log('Total signups:', countRes.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
