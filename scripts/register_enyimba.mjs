
import pg from 'pg';
import config from '../src/config.js';

const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

async function run() {
  const client = await pool.connect();
  try {
    const slug = 'enyimba-fc';
    const name = 'Enyimba International FC';
    const region = 'Nigeria';

    console.log(`Registering tribe: ${name} (${slug})...`);
    
    await client.query(`
      INSERT INTO tribes (id, slug, name, region, type, is_super_tribe, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, 'club', true, NOW())
      ON CONFLICT (slug) DO UPDATE 
      SET name = EXCLUDED.name, region = EXCLUDED.region, type = 'club', is_super_tribe = true
      RETURNING *;
    `, [slug, name, region]);

    console.log('Tribe registered successfully!');
  } catch (err) {
    console.error('Failed to register tribe:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
