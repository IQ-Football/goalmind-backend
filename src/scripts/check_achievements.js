
import pg from 'pg';
const { Client } = pg;

async function checkAchievements() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    const result = await client.query("SELECT id, name, slug FROM achievements WHERE name IN ('Deadlock Breaker', 'Tribal Spark') OR slug IN ('deadlock-breaker', 'tribal-spark')");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkAchievements();
