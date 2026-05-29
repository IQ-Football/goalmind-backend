import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

async function check() {
  await client.connect();
  const res = await client.query("SELECT id, email FROM users WHERE id = '50ae7ded-ecdb-4f8a-b20e-ec5a46998352'");
  console.log(JSON.stringify(res.rows));
  await client.end();
}
check();
