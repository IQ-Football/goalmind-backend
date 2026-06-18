import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'goalmind',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function seedSenatePoll() {
  const pollId = '550e8400-e29b-41d4-a716-446655440001';
  const title = 'Senate Poll #1: Future Feature Prioritization';
  const description = 'Founding Architects, choose the next major feature to be developed for the Arena.';
  const options = [
    { id: 'A', label: 'Global Clan Wars' },
    { id: 'B', label: 'Real-time VAR Predictions' },
    { id: 'C', label: 'Tribal Marketplace' },
    { id: 'D', label: 'Player Performance NFTs' }
  ];
  const endsAt = '2026-06-16T00:00:00Z';

  try {
    await pool.query(
      `INSERT INTO tribal_proposals (id, tribe_id, title, description, options, ends_at, status)
       VALUES ($1, NULL, $2, $3, $4, $5, 'active')
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         options = EXCLUDED.options,
         ends_at = EXCLUDED.ends_at,
         status = 'active'`,
      [pollId, title, description, JSON.stringify(options), endsAt]
    );
    console.log('Senate Poll #1 seeded successfully');
  } catch (err) {
    console.error('Error seeding Senate Poll #1:', err);
  } finally {
    await pool.end();
  }
}

seedSenatePoll();
