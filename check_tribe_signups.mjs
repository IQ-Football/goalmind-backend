import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

async function check() {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT t.name, t.slug, COUNT(u.id) as signups 
      FROM tribes t 
      LEFT JOIN users u ON t.id = u.tribe_id 
      GROUP BY t.id, t.name, t.slug 
      ORDER BY signups DESC
    `);
    console.log('Tribal Signups:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
