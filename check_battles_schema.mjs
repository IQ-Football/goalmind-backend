import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ 
    host: 'localhost',
    port: 5432,
    database: 'goalmind',
    user: 'postgres',
    password: 'postgres'
  });
  await client.connect();
  try {
    const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'battles'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
