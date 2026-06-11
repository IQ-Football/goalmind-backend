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
    console.log("Adding sector column to battles table...");
    await client.query("ALTER TABLE battles ADD COLUMN sector TEXT");
    console.log("Adding giza_pp_awarded column to battles table...");
    await client.query("ALTER TABLE battles ADD COLUMN giza_pp_awarded INTEGER DEFAULT 0");
    console.log("Migration successful.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.end();
  }
}
main();
