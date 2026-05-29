
import pg from 'pg';
const { Client } = pg;

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/goalmind'
  });

  await client.connect();

  try {
    console.log('Starting migration for Tribal Catch-Up & Bounty Logic...');

    // Add zero_broken_at to tribes
    await client.query(`
      ALTER TABLE tribes 
      ADD COLUMN IF NOT EXISTS zero_broken_at TIMESTAMP WITH TIME ZONE;
    `);

    // Add slug to achievements
    await client.query(`
      ALTER TABLE achievements 
      ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;
    `);

    // Add flags to tribe_members
    await client.query(`
      ALTER TABLE tribe_members 
      ADD COLUMN IF NOT EXISTS is_vanguard_100 BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_zero_breaker BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_founding_general BOOLEAN DEFAULT false;
    `);

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
