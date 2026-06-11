// Kenya Tribe Data Migration
const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('\nImporting Kenyan tribe data...\n');

    const kenyanTribes = [
      { name: 'Gor Mahia FC', slug: 'gor-mahia', type: 'club', primary_color: '#008000', secondary_color: '#FFFFFF', region: 'East Africa' },
      { name: 'AFC Leopards', slug: 'afc-leopards', type: 'club', primary_color: '#0000FF', secondary_color: '#FFFFFF', region: 'East Africa' },
      { name: 'Tusker FC', slug: 'tusker-fc', type: 'club', primary_color: '#FFFF00', secondary_color: '#000000', region: 'East Africa' },
      { name: 'Kenya', slug: 'kenya', type: 'nation', primary_color: '#922529', secondary_color: '#000000', region: 'East Africa' },
      { name: 'University of Nairobi', slug: 'uon-dynamite', type: 'university', colors: ['#003366', '#FFFFFF'], nickname: 'Dynamite', region: 'Nairobi' },
      { name: 'Kenyatta University', slug: 'ku-titans', type: 'university', colors: ['#CC0000', '#000000'], nickname: 'Titans', region: 'Nairobi' },
    ];

    let inserted = 0;
    for (const tribe of kenyanTribes) {
      await client.query(`
        INSERT INTO tribes (name, slug, type, primary_color, secondary_color, region, is_super_tribe)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (slug) DO UPDATE SET
          region = EXCLUDED.region,
          is_super_tribe = true
      `, [tribe.name, tribe.slug, tribe.type, tribe.primary_color || tribe.colors[0], tribe.secondary_color || tribe.colors[1], tribe.region]);
      inserted++;
    }

    console.log(`Inserted/updated ${inserted} Kenyan tribes`);

    // Set up rivalry
    const gor = await client.query("SELECT id FROM tribes WHERE slug = 'gor-mahia'");
    const leopards = await client.query("SELECT id FROM tribes WHERE slug = 'afc-leopards'");
    if (gor.rows[0] && leopards.rows[0]) {
        await client.query("UPDATE tribes SET rival_tribe_ids = array_append(rival_tribe_ids, $1) WHERE id = $2", [leopards.rows[0].id, gor.rows[0].id]);
        await client.query("UPDATE tribes SET rival_tribe_ids = array_append(rival_tribe_ids, $1) WHERE id = $2", [gor.rows[0].id, leopards.rows[0].id]);
        console.log('   Rivalry: Gor Mahia vs AFC Leopards');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
