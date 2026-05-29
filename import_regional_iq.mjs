import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

const questions = [
  {
    content: "Simba SC was originally founded in 1936 under what name?",
    options: ["Sunderland", "Wekundu wa Msimbazi", "Pan African", "Young Africans"],
    correct_option_index: 0,
    difficulty: "hard",
    category: "History",
    tribe_id: "b9d9fc32-15e5-4221-be61-4231a6e05671", // Simba SC
    explanation: "Simba SC was originally founded as Sunderland before changing its name in 1971."
  },
  {
    content: "Which Burkinabe attacking midfielder became a star at Yanga in 2023/24?",
    options: ["Stephane Aziz Ki", "Djigui Diarra", "Khalid Aucho", "Pacome Zouzoua"],
    correct_option_index: 0,
    difficulty: "medium",
    category: "Culture",
    tribe_id: "c7d324cf-2419-4daa-85a1-dd3dd136f297", // Yanga SC
    explanation: "Stephane Aziz Ki has been a pivotal player for Yanga SC."
  },
  {
    content: "Who holds the record for the most appearances in a Kaizer Chiefs jersey?",
    options: ["Doctor Khumalo", "Itumeleng Khune", "Lucas Radebe", "Neil Tovey"],
    correct_option_index: 0,
    difficulty: "hard",
    category: "History",
    tribe_id: "bbe8ff8f-e246-4e31-b46d-cfc7fe93326e", // Kaizer Chiefs
    explanation: "Doctor Khumalo is a legend of the club with the most appearances."
  },
  {
    content: "Who scored the winning goal for Pirates in the 1995 CAF Champions League final?",
    options: ["Jerry Sikhosana", "Marks Maponyane", "Helman Mkhalele", "John Moeti"],
    correct_option_index: 0,
    difficulty: "hard",
    category: "History",
    tribe_id: "1f37663a-af6f-43a3-8aff-b308b78bb8dd", // Orlando Pirates
    explanation: "Jerry 'Legs of Thunder' Sikhosana scored the historic winner against ASEC Abidjan."
  }
];

async function main() {
  try {
    console.log(`Importing ${questions.length} regional questions...`);

    for (const q of questions) {
      await pool.query(
        `INSERT INTO questions (content, options, correct_option_index, difficulty, category, tags, explanation, tribe_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          q.content,
          JSON.stringify(q.options),
          q.correct_option_index,
          q.difficulty,
          q.category,
          ['Regional', 'History'],
          q.explanation,
          q.tribe_id
        ]
      );
    }

    console.log('Import finished.');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
