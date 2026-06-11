const { Client } = require('pg');

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

async function run() {
  console.log('Connecting to database...');
  try {
    await client.connect();
    const res = await client.query('SELECT * FROM shop_products');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
