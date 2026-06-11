
import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

const schedule = [
  {
    title: 'Casablanca Power Hour',
    day: 6,
    tribes: ['wydad-casablanca', 'raja-casablanca', 'morocco']
  },
  {
    title: 'West African IQ Throne',
    day: 7,
    tribes: ['nigeria', 'ghana']
  },
  {
    title: 'Cairo IQ Clash',
    day: 8,
    tribes: ['al-ahly', 'zamalek']
  },
  {
    title: 'Soweto Gilded Derby',
    day: 9,
    tribes: ['kaizer-chiefs', 'orlando-pirates']
  },
  {
    title: 'Kariakoo Tribal War',
    day: 10,
    tribes: ['simba-sc', 'yanga-sc']
  },
  {
    title: 'The Great Lakes Siege',
    day: 11,
    tribes: [] // Global for now as tribes might be new
  },
  {
    title: 'Maghreb Masterclass',
    day: 12,
    tribes: ['esperance-tunis', 'algeria', 'tunisia']
  },
  {
    title: 'The Imperial Weekend',
    day: 13,
    tribes: [] // Global
  },
  {
    title: 'The 45k Breach',
    day: 14,
    tribes: [] // Global
  },
  {
    title: 'The 50k Centurion Fall',
    day: 15,
    tribes: [] // Global
  }
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('Seeding derby windows...');
    
    // Clear existing
    await client.query('DELETE FROM derby_windows');

    for (const item of schedule) {
      const startTime = new Date(`2026-06-${item.day < 10 ? '0' + item.day : item.day}T18:00:00Z`);
      const endTime = new Date(`2026-06-${item.day < 10 ? '0' + item.day : item.day}T20:00:00Z`);

      let tribeIds = [];
      if (item.tribes.length > 0) {
        const tribeRes = await client.query('SELECT id FROM tribes WHERE slug = ANY($1)', [item.tribes]);
        tribeIds = tribeRes.rows.map(r => r.id);
      }

      await client.query(`
        INSERT INTO derby_windows (title, start_time, end_time, tribe_ids, multipliers)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        item.title,
        startTime,
        endTime,
        tribeIds,
        JSON.stringify({
          goal_tokens: 2,
          tribe_honor: 3,
          founding_recruiter_bounty: 2
        })
      ]);
      
      console.log(`Added ${item.title} (${startTime.toISOString()} - ${endTime.toISOString()})`);
    }

    console.log('Seeding complete.');
  } catch (err) {
    console.error('Error seeding derby windows:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
