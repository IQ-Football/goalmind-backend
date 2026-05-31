import pg from 'pg';
import config from './src/config.js';

console.log('Config Database:', config.database);

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: 'postgres' // Connect to default postgres db to list others
});

async function listDbs() {
  try {
    const res = await pool.query('SELECT datname FROM pg_database WHERE datistemplate = false');
    console.log('Databases:', res.rows.map(r => r.datname));
  } catch (err) {
    console.error('Error listing dbs:', err);
  } finally {
    await pool.end();
  }
}

listDbs();
