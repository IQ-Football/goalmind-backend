/**
 * Test User Provisioning Script
 * Creates 10,000 pre-authenticated test users for distributed load testing.
 * 
 * Usage: node scripts/provision_test_users.mjs [--count=10000] [--clear]
 */

import { createHash, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const { Pool } = pg;

const DEFAULT_COUNT = 10000;
const BATCH_SIZE = 500;
const JWT_SECRET = process.env.JWT_SECRET || 'goalmind-super-secret-jwt-key-change-in-production';
const TOKEN_EXPIRY = '24h';

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value;
  return acc;
}, {});

const count = parseInt(args.count || DEFAULT_COUNT);
const shouldClear = args.clear === 'true';

async function provisionTestUsers() {
  console.log(`Provisioning ${count} test users for load testing...\n`);

  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'goalmind',
    user: 'postgres',
    password: 'postgres',
    max: 10,
  });

  const client = await pool.connect();
  const results = [];

  try {
    if (shouldClear) {
      console.log('Clearing existing test users...');
      await client.query(`DELETE FROM users WHERE email LIKE 'testuser_%@test.com'`);
      console.log('Cleared.\n');
    }

    const tribeResult = await client.query('SELECT id FROM tribes ORDER BY RANDOM()');
    const tribeIds = tribeResult.rows.map(r => r.id);
    
    if (tribeIds.length === 0) {
      console.error('No tribes found. Please run the database seed first.');
      process.exit(1);
    }
    console.log(`Found ${tribeIds.length} tribes for assignment\n`);

    const existingResult = await client.query(`
      SELECT MAX(CAST(SUBSTRING(email FROM 'testuser_(\\d+)@test.com') AS INTEGER)) as max_num
      FROM users WHERE email LIKE 'testuser_%@test.com'
    `);
    const startNum = (existingResult.rows[0]?.max_num || 0) + 1;
    console.log(`Starting from user number ${startNum}\n`);

    let batchNum = 0;
    for (let i = 0; i < count; i += BATCH_SIZE) {
      batchNum++;
      const batchCount = Math.min(BATCH_SIZE, count - i);
      const batchValues = [];
      const batchParams = [];
      // paramIndex MUST be declared OUTSIDE the inner loop so it increments across all rows
      let paramIndex = 1; // start from 1 for each batch since batchParams is fresh

      for (let j = 0; j < batchCount; j++) {
        const userNum = startNum + i + j;
        const email = `testuser_${String(userNum).padStart(5, '0')}@test.com`;
        const username = `LoadTestUser_${userNum}`;
        const password = `testpass_${randomBytes(8).toString('hex')}`;
        const passwordHash = hashPassword(password);
        const tribeId = tribeIds[Math.floor(Math.random() * tribeIds.length)];

        batchValues.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4})`);
        batchParams.push(email, username, passwordHash, 1000, tribeId);
        paramIndex += 5;
      }

      const insertQuery = `
        INSERT INTO users (email, username, password_hash, elo, tribe_id)
        VALUES ${batchValues.join(', ')}
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email
      `;

      const insertResult = await client.query(insertQuery, batchParams);

      for (const row of insertResult.rows) {
        const userNum = parseInt(row.email.match(/testuser_(\d+)@test.com/)[1]);
        const token = jwt.sign(
          { id: row.id, email: row.email, username: row.username },
          JWT_SECRET,
          { expiresIn: TOKEN_EXPIRY }
        );

        results.push({
          userNumber: userNum,
          email: row.email,
          userId: row.id,
          token,
        });
      }

      console.log(`Batch ${batchNum}: Inserted ${insertResult.rowCount} users (total: ${results.length})`);
    }

    console.log(`\nSuccessfully provisioned ${results.length} test users\n`);

    const outputFile = `/home/team/shared/backend/test_users_${Date.now()}.json`;
    writeFileSync(outputFile, JSON.stringify({ users: results, generated: new Date().toISOString() }, null, 2));
    console.log(`Credentials saved to: ${outputFile}`);
    console.log(`\nSummary:`);
    console.log(`  Total users: ${results.length}`);
    console.log(`  Token expiry: ${TOKEN_EXPIRY}`);
    console.log(`\nLoad test example:`);
    console.log(`  TOKEN=$(jq -r '.users[0].token' ${outputFile})`);
    console.log(`  curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/battles/history\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

provisionTestUsers().catch(err => {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
});
