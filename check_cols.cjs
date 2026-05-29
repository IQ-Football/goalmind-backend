const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE '%tribe%'")
  .then(r => { console.log('Tribe columns in users:', r.rows); return pool.end(); })
  .catch(e => { console.error(e); pool.end(); });