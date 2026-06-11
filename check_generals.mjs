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
    const res = await client.query("SELECT COUNT(*) FROM hall_of_generals");
    console.log("Generals in Hall:", res.rows[0].count);
    
    if (parseInt(res.rows[0].count) > 0) {
      const details = await client.query("SELECT h.*, u.username FROM hall_of_generals h JOIN users u ON h.user_id = u.id LIMIT 5");
      console.log(JSON.stringify(details.rows, null, 2));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
