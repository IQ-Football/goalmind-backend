import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'goalmind'
});

async function main() {
  try {
    await client.connect();
    const res = await client.query('SELECT username, tribes.name as tribe FROM users JOIN tribes ON users.tribe_id = tribes.id ORDER BY users.created_at ASC');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
