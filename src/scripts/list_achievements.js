
import pg from 'pg';
const { Client } = pg;

async function listAchievements() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    const result = await client.query("SELECT id, name, slug FROM achievements");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

listAchievements();
