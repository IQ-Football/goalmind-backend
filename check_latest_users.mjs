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
    const res = await client.query(`
      SELECT u.id, u.username, t.name as tribe, u.created_at 
      FROM users u
      LEFT JOIN tribes t ON u.tribe_id = t.id
      ORDER BY u.created_at DESC
      LIMIT 200
    `);
    console.log('Latest Users:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
