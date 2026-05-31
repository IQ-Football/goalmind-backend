import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool(config.database);

async function checkSchema() {
  try {
    console.log('Checking all schemas...');
    const allSchemas = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata
    `);
    console.log('Schemas:', allSchemas.rows.map(r => r.schema_name));

    console.log('\nChecking all tables in ALL schemas...');
    const allTables = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
    `);
    console.log('Tables:', allTables.rows);

    console.log('\nChecking relay_matches columns...');
    const relayCols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'relay_matches'
    `);
    console.log('Relay matches columns:', relayCols.rows);

    console.log('\nChecking relay_matches indexes...');
    const relayIndexes = await pool.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'relay_matches'
    `);
    console.log('Relay matches indexes:', relayIndexes.rows);

  } catch (err) {
    console.error('Error checking schema:', err);
  } finally {
    await pool.end();
  }
}

checkSchema();
