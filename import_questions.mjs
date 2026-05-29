
import pg from 'pg';
import config from './src/config.js';
import fs from 'fs';

const { Pool } = pg;

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
});

const tribesMapping = {
  'Al Ahly': '92bb68bb-dd1a-4e3f-b9a2-4c795ec8d219',
  'Zamalek': 'd1acfa09-485d-4a90-b39f-4c2745820974',
  'Kaizer Chiefs': 'bbe8ff8f-e246-4e31-b46d-cfc7fe93326e',
  'Orlando Pirates': '1f37663a-af6f-43a3-8aff-b308b78bb8dd',
  'Simba SC': '7789d380-4545-4235-85c1-a8ad5b1bb286', // Need to verify these
  'TP Mazembe': '9989d380-4545-4235-85c1-a8ad5b1bb286',
  'Yanga SC': '8889d380-4545-4235-85c1-a8ad5b1bb286'
};

// I need to fetch all tribes to be sure about the IDs for Simba, TP Mazembe, Yanga
async function getTribes() {
  const res = await pool.query('SELECT id, name FROM tribes');
  const mapping = {};
  res.rows.forEach(row => {
    mapping[row.name] = row.id;
  });
  return mapping;
}

async function main() {
  try {
    const tribes = await getTribes();
    const questionsRaw = JSON.parse(fs.readFileSync('/home/team/shared/BIG7_QUESTIONS.json', 'utf8'));
    
    // The task mentions 280 questions, but the file has 140. 
    // However, the description says "from '/home/team/shared/BIG7_QUESTIONS.json'".
    // If I combine it with BIG7_QUESTIONS_LOCALIZED.json I get 280, but they seem to be the same IDs.
    // I will import what is in BIG7_QUESTIONS.json and assume the 280 might refer to something else or I should just follow the file path provided.
    // Wait, let's just check if there are 280 if I don't deduplicate by ID.
    // Actually, I'll just import from the provided file.
    
    const questions = questionsRaw;
    
    console.log(`Found ${questions.length} questions in JSON.`);
    
    let imported = 0;
    let skipped = 0;
    
    const manualMapping = {
      'Yanga SC': 'Young Africans SC',
      'Zamalek': 'Zamalek SC'
    };
    
    for (const q of questions) {
      const tribeName = manualMapping[q.tribe] || q.tribe;
      const tribeId = tribes[tribeName];
      
      if (!tribeId) {
        console.warn(`Tribe not found: ${q.tribe}`);
        skipped++;
        continue;
      }
      
      // Map difficulty string to allowed values ('easy', 'medium', 'hard', 'expert')
      // JSON has numbers 1, 2, 3.
      const difficultyMap = {
        1: 'easy',
        2: 'medium',
        3: 'hard'
      };
      const difficulty = difficultyMap[q.difficulty] || 'medium';
      
      // Find correct option index
      const correctOptionIndex = q.options.indexOf(q.correct_answer);
      
      if (correctOptionIndex === -1) {
        console.warn(`Correct answer not found in options for question: ${q.text}`);
        skipped++;
        continue;
      }
      
      // Check for duplicates (by content and tribe_id)
      const dupCheck = await pool.query(
        'SELECT id FROM questions WHERE content = $1 AND tribe_id = $2',
        [q.text, tribeId]
      );
      
      if (dupCheck.rowCount > 0) {
        skipped++;
        continue;
      }
      
      await pool.query(
        `INSERT INTO questions (content, options, correct_option_index, difficulty, category, tags, explanation, tribe_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          q.text,
          JSON.stringify(q.options),
          correctOptionIndex,
          difficulty,
          q.category,
          q.tags,
          q.explanation,
          tribeId
        ]
      );
      imported++;
    }
    
    console.log(`Import finished. Imported: ${imported}, Skipped/Duplicates: ${skipped}`);
    
    const totalCount = await pool.query('SELECT COUNT(*) FROM questions');
    console.log(`Total questions in DB: ${totalCount.rows[0].count}`);
    
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
