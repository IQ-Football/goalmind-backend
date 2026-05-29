
import pg from 'pg';
import config from '../src/config.js';
import { v4 as uuidv4 } from 'uuid';

const tribes = [
  {
    name: 'Espérance de Tunis',
    slug: 'esperance-tunis',
    region: 'North Africa',
    type: 'club',
    is_super_tribe: true
  },
  {
    name: 'Al-Ahli Tripoli',
    slug: 'al-ahli-tripoli',
    region: 'North Africa',
    type: 'club',
    is_super_tribe: true
  },
  {
    name: 'Nkana FC',
    slug: 'nkana-fc',
    region: 'Southern Africa',
    type: 'club',
    is_super_tribe: true
  },
  {
    name: 'Asante Kotoko',
    slug: 'asante-kotoko',
    region: 'West Africa',
    type: 'club',
    is_super_tribe: true
  }
];

async function registerTribes() {
  const client = new pg.Client({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name
  });

  await client.connect();
  console.log('Connected to database');

  try {
    for (const tribe of tribes) {
      const { name, slug, region, type, is_super_tribe } = tribe;
      
      const query = `
        INSERT INTO tribes (id, name, slug, region, type, is_super_tribe)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (slug) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          region = EXCLUDED.region,
          type = EXCLUDED.type,
          is_super_tribe = EXCLUDED.is_super_tribe
        RETURNING *;
      `;
      
      const values = [uuidv4(), name, slug, region, type, is_super_tribe];
      const res = await client.query(query, values);
      console.log(`Registered/Updated tribe: ${res.rows[0].name} (${res.rows[0].slug}) - Super Tribe: ${res.rows[0].is_super_tribe}`);
    }
  } catch (err) {
    console.error('Error registering tribes:', err);
  } finally {
    await client.end();
    console.log('Disconnected from database');
  }
}

registerTribes();
