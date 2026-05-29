
import fs from 'fs';
import pg from 'pg';
import config from '../src/config.js';
import { v4 as uuidv4 } from 'uuid';

const difficultyMap = {
  '1': 'easy',
  '2': 'medium',
  '3': 'hard'
};

async function importPacks() {
  const client = new pg.Client({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name
  });

  await client.connect();
  console.log('Connected to database');

  const tribesRes = await client.query("SELECT id, name, slug FROM tribes");
  const tribes = tribesRes.rows;

  const tribeMap = {};
  tribes.forEach(t => {
    tribeMap[t.name.toLowerCase()] = t.id;
    tribeMap[t.slug.toLowerCase()] = t.id;
    // Manual overrides for JSON names
    if (t.slug === 'enyimba-fc') tribeMap['enyimba'] = t.id;
    if (t.slug === 'al-ahly') tribeMap['al ahly sc'] = t.id;
    if (t.slug === 'zamalek') tribeMap['zamalek sc'] = t.id;
    if (t.slug === 'esperance-tunis') tribeMap['esp\u00e9rance de tunis'] = t.id;
    if (t.slug === 'simba-sc') tribeMap['simba'] = t.id;
    if (t.slug === 'yanga-sc') tribeMap['yanga'] = t.id;
    if (t.slug === 'raja-casablanca') tribeMap['raja'] = t.id;
    if (t.slug === 'wydad-casablanca') tribeMap['wydad'] = t.id;
  });

  console.log('Tribe Map keys:', Object.keys(tribeMap).filter(k => k.includes('ahly') || k.includes('zamalek')));

  const files = [
    '/home/team/shared/BIG11_RIVALS_ELITE_PACK.json',
    '/home/team/shared/BIG15_NEW_GIANTS_PACK.json'
  ];

  let totalImported = 0;
  let skipped = 0;

  for (const file of files) {
    console.log(`Processing ${file}...`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const questions = data.questions;

    for (const q of questions) {
      if (q.tribe.toLowerCase() === 'continental') {
        skipped++;
        continue;
      }

      const rawTribe = q.tribe.toLowerCase();
      let tribeIds = [];

      if (rawTribe.includes(' / ')) {
        const parts = rawTribe.split(' / ');
        parts.forEach(p => {
          const tid = tribeMap[p.trim()];
          if (tid) tribeIds.push(tid);
          else console.warn(`Warning: Could not find tribe_id for part "${p.trim()}" in dual tribe "${q.tribe}"`);
        });
      } else {
        const tid = tribeMap[rawTribe];
        if (tid) tribeIds.push(tid);
      }

      if (tribeIds.length === 0) {
        console.warn(`Warning: Could not find any tribe_id for tribe "${q.tribe}" in question: ${q.text}`);
        skipped++;
        continue;
      }

      const difficulty = difficultyMap[q.difficulty.toString()] || 'medium';
      const correctOptionIndex = q.options.indexOf(q.correct_answer);
      
      if (correctOptionIndex === -1) {
        console.warn(`Warning: Correct answer not found in options for question: ${q.text}`);
        skipped++;
        continue;
      }

      for (const tribeId of tribeIds) {
        try {
          // Check for duplicates
          const existing = await client.query(
            "SELECT id FROM questions WHERE content = $1 AND tribe_id = $2",
            [q.text, tribeId]
          );

          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          await client.query(
            `INSERT INTO questions (id, content, options, correct_option_index, tribe_id, category, difficulty, tags, explanation, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              uuidv4(),
              q.text,
              JSON.stringify(q.options),
              correctOptionIndex,
              tribeId,
              q.category,
              difficulty,
              q.tags || [],
              q.explanation || null
            ]
          );
          totalImported++;
        } catch (err) {
          console.error(`Error importing question: ${q.text}`, err);
        }
      }
    }
  }

  console.log(`Successfully imported ${totalImported} questions.`);
  console.log(`Skipped/Duplicate ${skipped} items.`);
  await client.end();
}

importPacks().catch(console.error);
