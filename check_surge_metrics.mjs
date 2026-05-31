import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool(config.database);

async function run() {
  const slugs = ['nigeria', 'ghana', 'morocco', 'uct-ikey-tigers', 'wits-clever-boys'];
  const res = await pool.query('SELECT name, slug, member_count FROM tribes WHERE slug = ANY($1)', [slugs]);
  console.log(JSON.stringify(res.rows, null, 2));
  
  for (const row of res.rows) {
      const userCount = await pool.query('SELECT COUNT(*)::int as count FROM users WHERE tribe_id = (SELECT id FROM tribes WHERE slug = $1)', [row.slug]);
      console.log(`${row.name} (${row.slug}): Tribe member_count=${row.member_count}, Actual user count=${userCount.rows[0].count}`);
  }
  
  await pool.end();
}
run().catch(console.error);
