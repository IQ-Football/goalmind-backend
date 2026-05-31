import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

const TOURNAMENT_START_DATE = '2026-05-11T00:00:00Z';

async function run() {
  try {
    const query = `
      EXPLAIN ANALYZE
      WITH battle_stats AS (
        SELECT 
          winner_tribe_id as tribe_id,
          COUNT(*) as battle_wins,
          SUM(tribe_points_awarded) as battle_points
        FROM battles
        WHERE status = 'completed' AND ended_at >= $1
        GROUP BY winner_tribe_id
      ),
      relay_stats AS (
        SELECT 
          winner_tribe_id as tribe_id,
          COUNT(*) as relay_wins,
          SUM(CASE WHEN winner_tribe_id = tribe_a_id THEN tribe_a_score ELSE tribe_b_score END) as relay_score
        FROM relay_matches
        WHERE status = 'completed' AND created_at >= $1 AND winner_tribe_id IS NOT NULL
        GROUP BY winner_tribe_id
      )
      SELECT 
        t.id, 
        t.name, 
        COALESCE(b.battle_wins, 0) as battle_wins,
        (COALESCE(r.relay_wins, 0) * 500 + COALESCE(b.battle_wins, 0) * 10 + COALESCE(r.relay_score, 0) * 0.1) as tournament_score
      FROM tribes t
      LEFT JOIN battle_stats b ON t.id = b.tribe_id
      LEFT JOIN relay_stats r ON t.id = r.tribe_id
      WHERE t.is_super_tribe = true OR t.is_national_tribe = true
      ORDER BY tournament_score DESC
      LIMIT 20
    `;

    const res = await pool.query(query, [TOURNAMENT_START_DATE]);
    console.log('Query Performance:');
    res.rows.forEach(row => console.log(row['QUERY PLAN']));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}
run();
