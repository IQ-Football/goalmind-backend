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
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hall_of_generals'");
    console.log("Table exists:", res.rows.length > 0);
    
    if (res.rows.length > 0) {
      const columns = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'hall_of_generals'");
      console.log("Columns:", JSON.stringify(columns.rows));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
