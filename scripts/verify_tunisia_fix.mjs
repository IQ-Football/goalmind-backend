
import { Pool } from 'pg';
import { PARTNER_CODES } from '../src/services/referralService.js';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres'
});

async function testTunisiaSignup() {
  console.log('Testing Tunisia (Esperance) Signup Flow...');
  
  // 1. Verify Partner Code exists and matches the DB ID
  const partnerCode = 'GM_EST';
  const expectedTribeId = PARTNER_CODES[partnerCode];
  console.log(`Partner Code: ${partnerCode}, Expected Tribe ID: ${expectedTribeId}`);

  const res = await pool.query('SELECT id, name, slug FROM tribes WHERE id = $1', [expectedTribeId]);
  
  if (res.rows.length === 0) {
    console.error('FAIL: Tribe ID in PARTNER_CODES not found in database!');
  } else {
    const tribe = res.rows[0];
    console.log(`SUCCESS: Tribe found - Name: ${tribe.name}, Slug: ${tribe.slug}`);
    if (tribe.slug === 'esperance-de-tunis') {
        console.log('CONFIRMED: Tribe ID correctly maps to Espérance de Tunis.');
    } else {
        console.error(`FAIL: Tribe ID maps to ${tribe.slug} instead of esperance-de-tunis!`);
    }
  }

  // 2. Check for any other technical failures (e.g. constraints)
  // Since I can't easily perform a full HTTP signup here, I've verified the data mapping which was the suspected cause.
  
  await pool.end();
}

testTunisiaSignup().catch(err => {
  console.error(err);
  process.exit(1);
});
