
import Fastify from 'fastify';
import dbPlugin from './src/plugins/db.js';

const seedAresSurge = async () => {
  const fastify = Fastify();
  await fastify.register(dbPlugin);
  await fastify.ready();

  const ARES_SURGE_ID = '4b6c8914-87be-47ea-8942-d64e9a8f2765';
  
  try {
    const check = await fastify.db.query('SELECT id FROM achievements WHERE id = $1', [ARES_SURGE_ID]);
    
    if (check.rows.length === 0) {
      console.log('Seeding Ares Surge badge...');
      await fastify.db.query(`
        INSERT INTO achievements (id, name, description, tier, criteria)
        VALUES ($1, 'Ares Surge', 'Golden Lightning: 1.2x GoalToken yield across all earning mechanics.', 1, 'Awarded to the first 25k users who witnessed the Golden Fire ritual.')
      `, [ARES_SURGE_ID]);
      console.log('Seeded successfully.');
    } else {
      console.log('Ares Surge badge already exists.');
    }
  } catch (err) {
    console.error('Error seeding badge:', err);
  } finally {
    await fastify.close();
  }
};

seedAresSurge();
