import pg from 'pg';
const { Client } = pg;

const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';

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
    console.log("Searching for users with Founding General badge...");
    const res = await client.query(`
      SELECT ua.user_id, u.tribe_id 
      FROM user_achievements ua
      JOIN users u ON ua.user_id = u.id
      WHERE ua.achievement_id = $1
    `, [FOUNDING_GENERAL_ID]);
    
    console.log(`Found ${res.rows.length} users. Inducting...`);
    
    for (const row of res.rows) {
      await client.query(
        'INSERT INTO hall_of_generals (user_id, tribe_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [row.user_id, row.tribe_id, 'Founding General Status (Launch Phase)']
      );
    }
    console.log("Backfill complete.");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
