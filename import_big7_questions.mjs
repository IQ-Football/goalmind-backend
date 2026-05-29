import pg from 'pg';
import fs from 'fs';
import config from './src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

async function run() {
  const data = JSON.parse(fs.readFileSync('/home/team/shared/BIG7_QUESTIONS.json', 'utf8'));
  
  // Get tribes
  const tribesRes = await pool.query('SELECT id, name FROM tribes');
  const tribeMap = {};
  tribesRes.rows.forEach(t => {
    tribeMap[t.name] = t.id;
  });

  // Manual mappings for discrepancies
  const manualTribeMap = {
    'Zamalek': tribeMap['Zamalek SC'],
    'Yanga SC': tribeMap['Young Africans SC'],
    'Al Ahly': tribeMap['Al Ahly SC'],
  };

  const questions = [];
  for (const entry of data) {
    const tribeId = manualTribeMap[entry.tribe] || tribeMap[entry.tribe];
    if (!tribeId) {
      console.error(`Tribe not found: ${entry.tribe}`);
      continue;
    }

    const correctIndex = entry.options.indexOf(entry.correct_answer);
    if (correctIndex === -1) {
      console.error(`Correct answer not in options for entry: ${entry.id}`);
      continue;
    }

    const difficultyMap = { 1: 'easy', 2: 'medium', 3: 'hard' };
    const difficulty = difficultyMap[entry.difficulty] || 'medium';

    // English version
    questions.push({
      content: entry.text,
      options: JSON.stringify(entry.options),
      correct_option_index: correctIndex,
      difficulty: difficulty,
      category: entry.category,
      tags: [...(entry.tags || []), 'en'],
      tribe_id: tribeId
    });

    // Localized version
    if (entry.text_localized && entry.text_localized !== entry.text) {
      questions.push({
        content: entry.text_localized,
        options: JSON.stringify(entry.options),
        correct_option_index: correctIndex,
        difficulty: difficulty,
        category: entry.category,
        tags: [...(entry.tags || []), entry.language],
        tribe_id: tribeId
      });
    }
  }

  console.log(`Prepared ${questions.length} question versions.`);

  let addedCount = 0;
  for (const q of questions) {
    const check = await pool.query(
      'SELECT id FROM questions WHERE content = $1 AND tribe_id = $2',
      [q.content, q.tribe_id]
    );

    if (check.rows.length === 0) {
      await pool.query(
        'INSERT INTO questions (content, options, correct_option_index, difficulty, category, tags, tribe_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [q.content, q.options, q.correct_option_index, q.difficulty, q.category, q.tags, q.tribe_id]
      );
      addedCount++;
    }
  }

  console.log(`Added ${addedCount} new question versions.`);
  const total = await pool.query('SELECT count(*) FROM questions');
  console.log(`Total questions in DB: ${total.rows[0].count}`);

  await pool.end();
}

run().catch(console.error);
