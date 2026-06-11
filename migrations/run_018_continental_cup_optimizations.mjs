
import pkg from 'pg';
const { Client } = pkg;

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/goalmind'
  });

  try {
    await client.connect();
    console.log('Running migration: 018_continental_cup_optimizations');

    // Create Materialized View for Active User Stats
    // Active User = 5+ battles in last 7 days
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS active_user_stats AS
      SELECT 
          u.id as user_id, 
          u.tribe_id,
          COUNT(b.id) as battle_count
      FROM users u
      JOIN battles b ON (b.player1_id = u.id OR b.player2_id = u.id)
      WHERE b.created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY u.id, u.tribe_id
      HAVING COUNT(b.id) >= 5;
    `);

    // Create index on tribe_id for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_active_user_stats_tribe_id ON active_user_stats(tribe_id);
    `);

    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

run();
