import pg from 'pg';
import config from './src/config.js';
const { Client } = pg;
const client = new Client({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});
await client.connect();
const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tribe_members'");
console.log(res.rows);
await client.end();
