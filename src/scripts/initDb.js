import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDatabase() {
  // First connect without database to create it if needed
  const adminPool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: 'postgres',
  });

  try {
    // Check if database exists, create if not
    const dbCheck = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [config.database.name]
    );

    if (dbCheck.rows.length === 0) {
      console.log(`Creating database: ${config.database.name}`);
      await adminPool.query(`CREATE DATABASE ${config.database.name}`);
    }

    await adminPool.end();

    // Now connect to the actual database
    const pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
    });

    console.log('Connected to GoalMind database');

    // Read and execute schema
    const schemaPath = path.join(__dirname, '../models/database_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema...');
    
    // Execute schema statements one by one to handle errors
    const statements = schema.split(';').filter(s => s.trim().length > 0);
    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (err) {
        // Ignore duplicate errors for CREATE statements
        if (!err.message.includes('already exists')) {
          console.log(`Warning: ${err.message}`);
        }
      }
    }
    console.log('Schema created/verified successfully');

    // Seed tribes
    console.log('Seeding tribes...');
    const tribesResult = await pool.query('SELECT COUNT(*) FROM tribes');
    
    if (parseInt(tribesResult.rows[0].count) === 0) {
      const tribes = [
        // Clubs
        { name: 'Real Madrid', type: 'club', slug: 'real-madrid', primary_color: '#FFFFFF', secondary_color: '#0055A5' },
        { name: 'Barcelona', type: 'club', slug: 'barcelona', primary_color: '#A50044', secondary_color: '#004D98' },
        { name: 'Liverpool', type: 'club', slug: 'liverpool', primary_color: '#C8102E', secondary_color: '#00B2A9' },
        { name: 'Manchester United', type: 'club', slug: 'manchester-united', primary_color: '#DA291C', secondary_color: '#FBEQE' },
        { name: 'Chelsea', type: 'club', slug: 'chelsea', primary_color: '#034694', secondary_color: '#DBA111' },
        { name: 'Arsenal', type: 'club', slug: 'arsenal', primary_color: '#EF0107', secondary_color: '#063672' },
        { name: 'Manchester City', type: 'club', slug: 'manchester-city', primary_color: '#6CABDD', secondary_color: '#1C2C5B' },
        { name: 'Bayern Munich', type: 'club', slug: 'bayern-munich', primary_color: '#DC052D', secondary_color: '#0066B2' },
        { name: 'Juventus', type: 'club', slug: 'juventus', primary_color: '#000000', secondary_color: '#FFFFFF' },
        { name: 'AC Milan', type: 'club', slug: 'ac-milan', primary_color: '#FB090B', secondary_color: '#000000' },
        // African Giants
        { name: 'Al Ahly', type: 'club', slug: 'al-ahly', primary_color: '#CE1126', secondary_color: '#000000' },
        { name: 'Zamalek', type: 'club', slug: 'zamalek', primary_color: '#FFFFFF', secondary_color: '#E31E24' },
        { name: 'Raja Casablanca', type: 'club', slug: 'raja-casablanca', primary_color: '#00994C', secondary_color: '#FFFFFF' },
        { name: 'Wydad Casablanca', type: 'club', slug: 'wydad-casablanca', primary_color: '#EF0107', secondary_color: '#FFFFFF' },
        { name: 'Espérance de Tunis', type: 'club', slug: 'esperance-de-tunis', primary_color: '#EF0107', secondary_color: '#FFD700' },
        { name: 'Simba SC', type: 'club', slug: 'simba-sc', primary_color: '#EF0107', secondary_color: '#FFFFFF' },
        { name: 'Young Africans SC', type: 'club', slug: 'yanga-sc', primary_color: '#FFD700', secondary_color: '#00994C' },
        { name: 'TP Mazembe', type: 'club', slug: 'tp-mazembe', primary_color: '#000000', secondary_color: '#FFFFFF' },
        { name: 'Kaizer Chiefs', type: 'club', slug: 'kaizer-chiefs', primary_color: '#FAC600', secondary_color: '#000000' },
        { name: 'Orlando Pirates', type: 'club', slug: 'orlando-pirates', primary_color: '#000000', secondary_color: '#FFFFFF' },
        { name: 'Mamelodi Sundowns', type: 'club', slug: 'mamelodi-sundowns', primary_color: '#002B5C', secondary_color: '#FAC600' },
        { name: 'Asante Kotoko', type: 'club', slug: 'asante-kotoko', primary_color: '#EF0107', secondary_color: '#000000' },
        
        { name: 'Atletico Madrid', type: 'club', slug: 'atletico-madrid', primary_color: '#CB3524', secondary_color: '#0067A5' },
        { name: 'Benfica', type: 'club', slug: 'benfica', primary_color: '#FF0000', secondary_color: '#FFFFFF' },
        { name: 'West Ham United', type: 'club', slug: 'west-ham-united', primary_color: '#7A263A', secondary_color: '#1BB1C7' },
        { name: 'Olympique Lyonnais', type: 'club', slug: 'olympique-lyonnais', primary_color: '#1B1B1B', secondary_color: '#FFFFFF' },
        { name: 'FC Köln', type: 'club', slug: 'fc-koln', primary_color: '#FB090B', secondary_color: '#000000' },
        { name: 'Deportivo La Coruña', type: 'club', slug: 'deportivo-la-coruna', primary_color: '#0055A5', secondary_color: '#FFFFFF' },
        // Cities
        { name: 'London', type: 'city', slug: 'london', primary_color: '#000000', secondary_color: '#DC143C' },
        { name: 'Manchester', type: 'city', slug: 'manchester', primary_color: '#6CABDD', secondary_color: '#DA291C' },
        { name: 'Madrid', type: 'city', slug: 'madrid', primary_color: '#EE3524', secondary_color: '#0055A5' },
        { name: 'Barcelona City', type: 'city', slug: 'barcelona-city', primary_color: '#A50044', secondary_color: '#004D98' },
        { name: 'Buenos Aires', type: 'city', slug: 'buenos-aires', primary_color: '#74ACDF', secondary_color: '#FFFFFF' },
        { name: 'Lagos', type: 'city', slug: 'lagos', primary_color: '#008751', secondary_color: '#FFFFFF' },
        { name: 'Nottingham', type: 'city', slug: 'nottingham', primary_color: '#DD0000', secondary_color: '#FFFFFF' },
        { name: 'Milan', type: 'city', slug: 'milan', primary_color: '#FB090B', secondary_color: '#000000' },
        { name: 'Lyon', type: 'city', slug: 'lyon', primary_color: '#1B1B1B', secondary_color: '#FFFFFF' },
        { name: 'Cologne', type: 'city', slug: 'cologne', primary_color: '#FB090B', secondary_color: '#000000' },
        { name: 'A Coruña', type: 'city', slug: 'a-coruna', primary_color: '#0055A5', secondary_color: '#FFFFFF' },
        // Universities
        { name: 'University of Manchester', type: 'university', slug: 'university-of-manchester', primary_color: '#006F62', secondary_color: '#832593' },
        { name: 'Ohio State University', type: 'university', slug: 'ohio-state-university', primary_color: '#BB0000', secondary_color: '#FFFFFF' },
        { name: 'UCLA', type: 'university', slug: 'ucla', primary_color: '#2770C7', secondary_color: '#FFD700' },
        { name: 'University of Lagos', type: 'university', slug: 'university-of-lagos', primary_color: '#6B2D8B', secondary_color: '#EE3524' },
        { name: 'Saint Louis University', type: 'university', slug: 'saint-louis-university', primary_color: '#0072CE', secondary_color: '#FFFFFF' },
        { name: 'Oxford University', type: 'university', slug: 'oxford-university', primary_color: '#00267F', secondary_color: '#F5B712' },
        { name: 'Stanford University', type: 'university', slug: 'stanford-university', primary_color: '#8C1515', secondary_color: '#FFFFFF' },
        { name: 'University of North Carolina', type: 'university', slug: 'university-of-north-carolina', primary_color: '#7B2D8B', secondary_color: '#FFFFFF' },
        { name: 'UC Santa Barbara', type: 'university', slug: 'uc-santa-barbara', primary_color: '#003087', secondary_color: '#FFC72C' },
      ];

      for (const tribe of tribes) {
        await pool.query(
          `INSERT INTO tribes (name, type, slug, primary_color, secondary_color) 
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (slug) DO NOTHING`,
          [tribe.name, tribe.type, tribe.slug, tribe.primary_color, tribe.secondary_color]
        );
      }
      console.log(`Seeded ${tribes.length} tribes`);
    } else {
      console.log('Tribes already exist, skipping...');
    }

    // Seed questions
    const questionsResult = await pool.query('SELECT COUNT(*) FROM questions');
    
    if (parseInt(questionsResult.rows[0].count) === 0) {
      console.log('Loading questions from questions_sample.json...');
      
      const questionsPath = '/home/team/shared/questions_sample.json';
      const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

      // Map tribe names to IDs
      const tribeMapResult = await pool.query('SELECT name, id FROM tribes');
      const tribeMap = {};
      tribeMapResult.rows.forEach(row => {
        tribeMap[row.name] = row.id;
      });

      // Map difficulty numbers to strings
      const difficultyMap = { 1: 'easy', 2: 'medium', 3: 'hard', 4: 'expert' };

      // Insert questions
      let insertedCount = 0;
      for (const q of questionsData) {
        const correctIndex = q.options.indexOf(q.correct_answer);
        
        if (correctIndex === -1) {
          console.warn(`Skipping question "${q.text}" - correct answer not found in options`);
          continue;
        }

        const tribeId = tribeMap[q.tribe] || null;

        await pool.query(
          `INSERT INTO questions (content, options, correct_option_index, difficulty, category, tags, tribe_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            q.text,
            JSON.stringify(q.options),
            correctIndex,
            difficultyMap[q.difficulty] || 'medium',
            q.category,
            q.tags,
            tribeId
          ]
        );
        insertedCount++;
      }
      console.log(`Seeded ${insertedCount} questions`);
    } else {
      console.log('Questions already exist, skipping...');
    }

    // Seed leagues
    const leaguesResult = await pool.query('SELECT COUNT(*) FROM leagues');
    
    if (parseInt(leaguesResult.rows[0].count) === 0) {
      console.log('Seeding leagues...');
      const leagues = [
        { name: 'Regional Divisions', tier: 5, slug: 'regional-divisions', min_elo: 0,    max_elo: 1000 },
        { name: 'League One',         tier: 4, slug: 'league-one',         min_elo: 1001, max_elo: 1400 },
        { name: 'Championship',       tier: 3, slug: 'championship',       min_elo: 1401, max_elo: 1800 },
        { name: 'Premier League',     tier: 2, slug: 'premier-league',     min_elo: 1801, max_elo: 2200 },
        { name: 'Global Arena',       tier: 1, slug: 'global-arena',       min_elo: 2201, max_elo: 99999 },
      ];

      for (const league of leagues) {
        await pool.query(
          `INSERT INTO leagues (name, tier, slug, min_elo, max_elo, season_number, is_active)
           VALUES ($1, $2, $3, $4, $5, 1, true)
           ON CONFLICT (slug) DO NOTHING`,
          [league.name, league.tier, league.slug, league.min_elo, league.max_elo]
        );
      }
      console.log(`Seeded ${leagues.length} leagues`);
    } else {
      console.log('Leagues already exist, skipping...');
    }

    console.log('Database initialization complete!');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
}

initDatabase();
