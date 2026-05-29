import config from './src/config.js';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

console.log("--- INTEGRITY CHECK ---");

// Check for duplicate emails
const emailDupes = await pool.query("SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1");
console.log("Duplicate emails:", emailDupes.rows);

// Check for duplicate usernames
const usernameDupes = await pool.query("SELECT username, COUNT(*) FROM users GROUP BY username HAVING COUNT(*) > 1");
console.log("Duplicate usernames:", usernameDupes.rows);

// Check for users without a tribe
const noTribe = await pool.query("SELECT COUNT(*) FROM users WHERE tribe_id IS NULL");
console.log("Users without a tribe:", noTribe.rows[0].count);

// Check for users with invalid tribe_id
const invalidTribe = await pool.query("SELECT COUNT(*) FROM users WHERE tribe_id IS NOT NULL AND tribe_id NOT IN (SELECT id FROM tribes)");
console.log("Users with invalid tribe_id:", invalidTribe.rows[0].count);

await pool.end();
