import pkg from 'pg';
const { Client } = pkg;
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function query() {
  await client.connect();
  const sql = process.argv[2];
  try {
    const res = await client.query(sql);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err.message);
  }
  await client.end();
}
query();
