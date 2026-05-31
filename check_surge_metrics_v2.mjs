import pg from 'pg';
import config from './src/config.js';

const pool = new pg.Pool(config.database);

async function run() {
  const tribesToTrack = [
    { name: 'Nigeria National Tribe', slug: 'nigeria' },
    { name: 'Ghana National Tribe', slug: 'ghana' },
    { name: 'Morocco National Tribe', slug: 'morocco' },
    { name: 'UCT Ikey Tigers', slug: 'uct-ikey-tigers' },
    { name: 'Wits Clever Boys', slug: 'wits-clever-boys' }
  ];

  console.log('--- Surge Metrics Update ---');
  
  for (const tribe of tribesToTrack) {
    try {
      const tribeRes = await pool.query('SELECT id, name, member_count FROM tribes WHERE slug = $1', [tribe.slug]);
      if (tribeRes.rows.length === 0) {
        console.log(`Tribe ${tribe.name} (${tribe.slug}) not found.`);
        continue;
      }
      
      const tribeData = tribeRes.rows[0];
      const actualCountRes = await pool.query('SELECT COUNT(*)::int as count FROM users WHERE tribe_id = $1', [tribeData.id]);
      const actualCount = actualCountRes.rows[0].count;
      
      console.log(`${tribe.name}:`);
      console.log(`  - member_count (cached): ${tribeData.member_count}`);
      console.log(`  - Actual users in DB:    ${actualCount}`);
    } catch (e) {
      console.error(`Error fetching data for ${tribe.name}:`, e.message);
    }
  }

  // Also get total signups
  try {
    const totalRes = await pool.query('SELECT COUNT(*)::int as count FROM users');
    console.log(`\nTotal signups across all tribes: ${totalRes.rows[0].count}`);
  } catch (e) {
    console.error('Error fetching total signups:', e.message);
  }

  await pool.end();
}

run().catch(console.error);
