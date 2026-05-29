import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

async function check() {
  try {
    await client.connect();
    const res = await client.query('SELECT COUNT(*) FROM questions');
    console.log('Question count:', res.rows[0].count);
    const tribesRes = await client.query('SELECT tribe_id, COUNT(*) as signups FROM users GROUP BY tribe_id');
    console.log('Tribal Signups:', tribesRes.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
