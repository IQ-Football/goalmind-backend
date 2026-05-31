import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool({ ...config.database, database: config.database.name });

async function reconcile() {
  console.log('Starting member_count reconciliation...');
  try {
    const result = await pool.query(`
      UPDATE tribes t
      SET member_count = (
        SELECT COUNT(*) 
        FROM users u 
        WHERE u.tribe_id = t.id
      )
      RETURNING name, member_count;
    `);
    
    console.log(`Reconciled ${result.rows.length} tribes.`);
    result.rows.forEach(row => {
      console.log(`  - ${row.name}: ${row.member_count}`);
    });
  } catch (err) {
    console.error('Reconciliation failed:', err.message);
  } finally {
    await pool.end();
  }
}

reconcile();
