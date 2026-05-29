
import pg from 'pg';
const { Client } = pg;

async function checkCols() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    const result = await client.query("SELECT * FROM achievements LIMIT 1");
    console.log(Object.keys(result.rows[0] || {}));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkCols();
