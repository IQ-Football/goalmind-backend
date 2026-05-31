
import { Pool } from 'pg';
import { checkAndAward25kSurgeBadge } from '../services/achievementService.js';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'goalmind',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Mock fastify for the service
const fastify = {
  db: pool,
  log: {
    info: console.log,
    error: console.error,
    warn: console.warn
  }
};

async function backfill() {
  console.log('Starting backfill for 25k Surge badge...');
  
  try {
    // Find all users in order of creation
    const usersRes = await pool.query('SELECT id, username, created_at FROM users ORDER BY created_at ASC');
    const users = usersRes.rows;
    console.log(`Total users found: ${users.length}`);

    let awardedCount = 0;
    const START_INDEX = 23388;
    const END_INDEX = 25000;

    for (let i = 0; i < users.length; i++) {
      // User index is 0-based, so 23388th user is index 23387? 
      // No, if totalUsers was 23388, the next user (23389th) makes it 23389.
      // If we use index i, the 23389th user is i = 23388.
      
      if (i >= START_INDEX && i < END_INDEX) {
        const user = users[i];
        const success = await checkAndAward25kSurgeBadge(fastify, user.id);
        if (success) {
          awardedCount++;
        }
      }
    }

    console.log(`Backfill complete. Awarded ${awardedCount} badges.`);
  } catch (err) {
    console.error('Backfill failed:', err);
  } finally {
    await pool.end();
  }
}

backfill();
