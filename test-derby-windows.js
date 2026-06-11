
import pg from 'pg';
import config from './src/config.js';
import { getDerbyMultipliers } from './src/services/derbyService.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

const fastify = {
  db: pool,
  log: console
};

async function test() {
  try {
    console.log('Testing Derby Multipliers...');
    
    // 1. No active windows
    await pool.query('UPDATE derby_windows SET is_active = false');
    const m1 = await getDerbyMultipliers(fastify);
    console.log('Multipliers (None active):', m1);
    
    // 2. Active global window
    const now = new Date();
    const start = new Date(now.getTime() - 3600000);
    const end = new Date(now.getTime() + 3600000);
    
    await pool.query(`
        INSERT INTO derby_windows (title, start_time, end_time, tribe_ids, multipliers)
        VALUES ('Test Global Window', $1, $2, '{}', $3)
    `, [start, end, JSON.stringify({ goal_tokens: 2.5, tribe_honor: 4, founding_recruiter_bounty: 3 })]);
    
    const m2 = await getDerbyMultipliers(fastify);
    console.log('Multipliers (Global active):', m2);
    
    // 3. Active tribe-specific window
    const tribeId = '92bb68bb-dd1a-4e3f-b9a2-4c795ec8d219'; // Al Ahly
    await pool.query(`
        INSERT INTO derby_windows (title, start_time, end_time, tribe_ids, multipliers)
        VALUES ('Test Tribe Window', $1, $2, $3, $4)
    `, [start, end, [tribeId], JSON.stringify({ goal_tokens: 5, tribe_honor: 10, founding_recruiter_bounty: 5 })]);
    
    const m3 = await getDerbyMultipliers(fastify, tribeId);
    console.log('Multipliers (Tribe active):', m3);

    const m4 = await getDerbyMultipliers(fastify, 'bbe8ff8f-e246-4e31-b46d-cfc7fe93326e'); // Kaizer Chiefs
    console.log('Multipliers (Other tribe):', m4);

    // Cleanup
    await pool.query("DELETE FROM derby_windows WHERE title LIKE 'Test %'");
    await pool.query('UPDATE derby_windows SET is_active = true');

    console.log('Test complete.');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

test();
