
import pg from 'pg';
const { Client } = pg;

async function checkTribes() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    const result = await client.query("SELECT id, name, slug, member_count FROM tribes WHERE slug IN ('kaizer-chiefs', 'simba-sc', 'yanga-sc', 'al-ahly')");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkTribes();
