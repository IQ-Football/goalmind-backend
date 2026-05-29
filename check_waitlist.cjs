
const { Client } = require('pg');
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});
async function run() {
  try {
    await client.connect();
    const countRes = await client.query('SELECT COUNT(*) FROM waitlist;');
    console.log('Total Waitlist Signups:', countRes.rows[0].count);
    
    const tribeStats = await client.query('SELECT tribe_id, COUNT(*) FROM waitlist GROUP BY tribe_id;');
    console.log('Waitlist Breakdown:', tribeStats.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
