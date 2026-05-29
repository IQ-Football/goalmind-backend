import pg from 'pg';
import fs from 'fs';

const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

async function main() {
  try {
    const questionsRaw = JSON.parse(fs.readFileSync('/home/team/shared/ZAMALEK_HIGH_IQ_PACK.json', 'utf8'));
    const tribeId = 'd1acfa09-485d-4a90-b39f-4c2745820974'; // Zamalek SC

    console.log(`Found ${questionsRaw.length} questions in JSON.`);

    let imported = 0;
    for (const q of questionsRaw) {
      const correctOptionIndex = q.options.indexOf(q.correct_option);
      
      await pool.query(
        `INSERT INTO questions (content, options, correct_option_index, difficulty, category, tags, explanation, tribe_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          q.text,
          JSON.stringify(q.options),
          correctOptionIndex,
          'hard', // High IQ pack is hard
          'Tactics',
          ['Engineering', 'High-IQ'],
          q.rationale,
          tribeId
        ]
      );
      imported++;
    }

    console.log(`Import finished. Imported: ${imported}`);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
