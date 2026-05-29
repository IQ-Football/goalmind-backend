
import pg from 'pg';
const { Client } = pg;

async function checkDefault() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    const result = await client.query("SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'gem_transactions' AND column_name = 'id'");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkDefault();
