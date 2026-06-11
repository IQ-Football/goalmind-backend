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
    const res = await client.query("SELECT COUNT(*) FROM tribes");
    console.log("Total Tribes:", res.rows[0].count);
    const badgeCount = await client.query("SELECT COUNT(*) FROM user_achievements WHERE achievement_id = '550e8400-e29b-41d4-a716-446655440000'");
    console.log("Total Founding General Badges:", badgeCount.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
