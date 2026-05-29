import { v4 as uuidv4 } from 'uuid';

/**
 * Solo Challenges Service
 * 
 * Handles solo challenges, daily quests, historical scenarios,
 * and skill tree mastery tracking.
 */

// Daily quest templates
const DAILY_QUESTS = [
  {
    id: 'daily_warmup',
    name: 'The Warm-up',
    description: 'Answer 10 basic football trivia questions',
    type: 'daily',
    requirement: { type: 'questions_answered', count: 10 },
    reward: { type: 'iq_xp', amount: 50 },
  },
  {
    id: 'daily_tribe_scout',
    name: 'Tribe Scout',
    description: 'Correctly identify 5 logos of clubs in your selected Tribe\'s league',
    type: 'daily',
    requirement: { type: 'correct_answers', count: 5, category: 'tribe_league' },
    reward: { type: 'tribe_points', amount: 100 },
  },
  {
    id: 'daily_stat_tracker',
    name: 'Stat Tracker',
    description: 'Answer 5 questions based on yesterday\'s match results',
    type: 'daily',
    requirement: { type: 'correct_answers', count: 5, category: 'recent_matches' },
    reward: { type: 'iq_xp', amount: 75 },
  },
];

// Weekly quest templates
const WEEKLY_QUESTS = [
  {
    id: 'weekly_historian',
    name: 'The Historian',
    description: 'Complete 3 Historical Scenarios with a score of 80% or higher',
    type: 'weekly',
    requirement: { type: 'scenario_completed', count: 3, min_score: 80 },
    reward: { type: 'badge', badge_id: 'time_traveler' },
  },
  {
    id: 'weekly_tactical_master',
    name: 'Tactical Master',
    description: 'Complete the "Modern Metrics" Skill Tree',
    type: 'weekly',
    requirement: { type: 'skill_tree_completed', tree: 'modern_metrics' },
    reward: { type: 'flair', flair_id: 'tactician' },
  },
  {
    id: 'weekly_global_scout',
    name: 'Global Scout',
    description: 'Play solo challenges in 3 different regional Skill Trees',
    type: 'weekly',
    requirement: { type: 'skill_trees_played', count: 3 },
    reward: { type: 'iq_xp', amount: 500 },
  },
];

// Historical scenarios
const HISTORICAL_SCENARIOS = [
  {
    id: 'scenario_istanbul_2005',
    name: 'The Miracle of Istanbul',
    description: 'Relive the 2005 Champions League Final - Liverpool vs AC Milan',
    category: 'Champions League',
    difficulty: 'hard',
    questions: [
      { q: 'Who was the AC Milan captain who scored the opening goal in the 1st minute?', answer: 'Paolo Maldini', options: ['Paolo Maldini', 'Alessandro Nesta', 'Clarence Seedorf', 'Andrea Pirlo'] },
      { q: 'Who scored a brace for AC Milan in the first half to make it 3-0?', answer: 'Hernan Crespo', options: ['Hernan Crespo', 'Andriy Shevchenko', 'Kaka', 'Filippo Inzaghi'] },
      { q: 'Which Liverpool captain scored the first goal of the comeback in the 54th minute?', answer: 'Steven Gerrard', options: ['Steven Gerrard', 'Jamie Carragher', 'Xabi Alonso', 'Steven Gerrard'] },
      { q: 'Who scored the long-range strike to make it 3-2?', answer: 'Vladimir Smicer', options: ['Vladimir Smicer', 'Steven Gerrard', 'Xabi Alonso', 'Luis Garcia'] },
      { q: 'Who won the penalty that led to the 3-3 equalizer?', answer: 'Steven Gerrard', options: ['Steven Gerrard', 'Vladimir Smicer', 'Xabi Alonso', 'Luis Garcia'] },
      { q: 'Who took the penalty that was initially saved by Dida but then converted on the rebound?', answer: 'Xabi Alonso', options: ['Xabi Alonso', 'Steven Gerrard', 'Vladimir Smicer', 'Djibril Cisse'] },
      { q: 'Which Liverpool goalkeeper made a miraculous double save against Shevchenko in extra time?', answer: 'Jerzy Dudek', options: ['Jerzy Dudek', 'Scott Loach', 'Chris Kirkland', 'Daniel Agger'] },
      { q: 'Who missed the final penalty for AC Milan, handing Liverpool the trophy?', answer: 'Andriy Shevchenko', options: ['Andriy Shevchenko', 'Kaka', 'Clarence Seedorf', 'Andrea Pirlo'] },
      { q: 'Who was the manager of Liverpool during this final?', answer: 'Rafael Benitez', options: ['Rafael Benitez', 'Bob Paisley', 'Jurgen Klopp', 'Roy Evans'] },
      { q: 'In which city was the Ataturk Olympic Stadium located?', answer: 'Istanbul', options: ['Rome', 'Istanbul', 'Athens', 'Berlin'] },
    ],
  },
  {
    id: 'scenario_trebble_1999',
    name: 'The 1999 Treble',
    description: 'Manchester United\'s historic Champions League Final comeback',
    category: 'Champions League',
    difficulty: 'hard',
    questions: [
      { q: 'Against which team did Manchester United win the Premier League title on the final day?', answer: 'Tottenham Hotspur', options: ['Tottenham Hotspur', 'Arsenal', 'Chelsea', 'Liverpool'] },
      { q: 'Who scored the winning goal in the FA Cup semi-final replay against Arsenal?', answer: 'Ryan Giggs', options: ['Ryan Giggs', 'David Beckham', 'Paul Scholes', 'Andy Cole'] },
      { q: 'Who was the opponent in the 1999 FA Cup Final at Wembley?', answer: 'Newcastle United', options: ['Newcastle United', 'Arsenal', 'Chelsea', 'Tottenham Hotspur'] },
      { q: 'In the UCL Final, who scored the early free-kick for Bayern Munich?', answer: 'Mario Basler', options: ['Mario Basler', 'Oliver Kahn', 'Lothar Matthaus', 'Jens Jeremies'] },
      { q: 'Which Manchester United captain was suspended for the 1999 UCL Final?', answer: 'Roy Keane', options: ['Roy Keane', 'Peter Schmeichel', 'Gary Neville', 'David Beckham'] },
      { q: 'Who scored the 91st-minute equalizer in the UCL Final?', answer: 'Teddy Sheringham', options: ['Teddy Sheringham', 'Ole Gunnar Solskjaer', 'Dwight Yorke', 'Andy Cole'] },
      { q: 'Who scored the 93rd-minute winner from a corner?', answer: 'Ole Gunnar Solskjaer', options: ['Ole Gunnar Solskjaer', 'Teddy Sheringham', 'Dwight Yorke', 'Ryan Giggs'] },
      { q: 'Who provided the assist (via header) for the winning goal?', answer: 'Teddy Sheringham', options: ['Teddy Sheringham', 'Ryan Giggs', 'Gary Neville', 'David Beckham'] },
      { q: 'Which stadium hosted the 1999 UCL Final?', answer: 'Camp Nou', options: ['Camp Nou', 'Wembley', 'Old Trafford', 'Stamford Bridge'] },
      { q: 'Who was the legendary manager who achieved the Treble?', answer: 'Sir Alex Ferguson', options: ['Sir Alex Ferguson', 'Arsene Wenger', 'Jose Mourinho', 'David Moyes'] },
    ],
  },
  {
    id: 'scenario_worldcup_2022',
    name: '2022 World Cup Final',
    description: 'The GOAT\'s Coronation - Argentina vs France',
    category: 'World Cup',
    difficulty: 'expert',
    questions: [
      { q: 'Who scored Argentina\'s opening goal from the penalty spot?', answer: 'Lionel Messi', options: ['Lionel Messi', 'Angel Di Maria', 'Gonzalo Montiel', 'Paulo Dybala'] },
      { q: 'Who scored the second goal after a brilliant counter-attack?', answer: 'Angel Di Maria', options: ['Angel Di Maria', 'Lionel Messi', 'Julian Alvarez', 'Paulo Dybala'] },
      { q: 'How many goals did Kylian Mbappe score in the final?', answer: '3', options: ['1', '2', '3', '4'] },
      { q: 'In how many minutes did Mbappe score his first two goals to equalize?', answer: '97 seconds', options: ['45 seconds', '97 seconds', '120 seconds', '30 seconds'] },
      { q: 'Who scored Argentina\'s third goal in extra time?', answer: 'Lionel Messi', options: ['Lionel Messi', 'Angel Di Maria', 'Gonzalo Montiel', 'Julian Alvarez'] },
      { q: 'Which Argentine goalkeeper made a last-second save against Kolo Muani?', answer: 'Emiliano Martinez', options: ['Emiliano Martinez', 'Franco Armani', 'Walter Benitez', 'Gerónimo Rulli'] },
      { q: 'Who scored Argentina\'s winning penalty in the shootout?', answer: 'Gonzalo Montiel', options: ['Gonzalo Montiel', 'Lionel Messi', 'Paulo Dybala', 'Leandro Paredes'] },
      { q: 'Who won the Golden Boot for the tournament with 8 goals?', answer: 'Kylian Mbappe', options: ['Lionel Messi', 'Kylian Mbappe', 'Olivier Giroud', 'Julian Alvarez'] },
      { q: 'Who was the manager of Argentina for the 2022 World Cup?', answer: 'Lionel Scaloni', options: ['Lionel Scaloni', 'Diego Maradona', 'Marcelo Bielsa', 'Jorge Sampaoli'] },
      { q: 'This was Argentina\'s first World Cup title since which year?', answer: '1986', options: ['1978', '1986', '1990', '1994'] },
    ],
  },
  {
    id: 'scenario_invincibles_2004',
    name: 'The Invincibles',
    description: 'Arsenal\'s unbeaten Premier League season 2003/04',
    category: 'Premier League',
    difficulty: 'medium',
    questions: [
      { q: 'How many Premier League games did Arsenal remain unbeaten in during the 03/04 season?', answer: '38', options: ['30', '36', '38', '40'] },
      { q: 'Who was the top scorer for Arsenal in this season?', answer: 'Thierry Henry', options: ['Thierry Henry', 'Robert Pires', 'Dennis Bergkamp', 'Freddie Ljungberg'] },
      { q: 'At which stadium did Arsenal secure the title with a 2-2 draw?', answer: 'White Hart Lane', options: ['White Hart Lane', 'Old Trafford', 'Highbury', 'Stamford Bridge'] },
      { q: 'Who was the Arsenal manager during this historic run?', answer: 'Arsene Wenger', options: ['Arsene Wenger', 'Unai Emery', 'Mikel Arteta', 'Herbert Chapman'] },
      { q: 'Against which team did Arsenal play their final game of the season to remain unbeaten?', answer: 'Leicester City', options: ['Leicester City', 'Chelsea', 'Manchester United', 'Liverpool'] },
      { q: 'Which midfielder was known as \'The Powerhouse\' of this Invincibles side?', answer: 'Patrick Vieira', options: ['Patrick Vieira', 'Gilbert Meslin', 'Cesc Fabregas', ' Edu Gaspar'] },
      { q: 'Who was the primary goalkeeper for the Invincibles?', answer: 'Jens Lehmann', options: ['Jens Lehmann', 'Wesley Manning', 'Stuart Taylor', 'Gary O\'Neil'] },
      { q: 'Which winger scored a famous long-range goal against Chelsea at Highbury?', answer: 'Robert Pires', options: ['Robert Pires', 'Freddie Ljungberg', 'José Antonio Reyes', 'Thierry Henry'] },
      { q: 'How many draws did Arsenal record during the 38-game unbeaten season?', answer: '12', options: ['0', '8', '12', '15'] },
      { q: 'Which Swedish winger was a key part of the Invincibles\' attack?', answer: 'Freddie Ljungberg', options: ['Freddie Ljungberg', 'Robert Pires', 'Thierry Henry', 'Dennis Bergkamp'] },
    ],
  },
  {
    id: 'scenario_leicester_2016',
    name: 'Leicester City\'s Miracle',
    description: 'The 5000/1 Premier League title win 2015/16',
    category: 'Premier League',
    difficulty: 'medium',
    questions: [
      { q: 'Who was the manager of Leicester City during their title-winning season?', answer: 'Claudio Ranieri', options: ['Claudio Ranieri', 'Brendan Rodgers', 'Nigel Pearson', 'Steve Bruce'] },
      { q: 'Who broke the record for scoring in 11 consecutive Premier League games?', answer: 'Jamie Vardy', options: ['Jamie Vardy', 'Harry Kane', 'Sergio Aguero', 'Mohamed Salah'] },
      { q: 'Which Algerian winger won the PFA Player of the Year award?', answer: 'Riyad Mahrez', options: ['Riyad Mahrez', 'Jamie Vardy', 'N\'Golo Kante', 'Riyad Mahrez'] },
      { q: 'Which defensive midfielder was famously described as \'doing the work of two players\'?', answer: 'N\'Golo Kante', options: ['N\'Golo Kante', 'Danny Drinkwater', 'Wilfried Ndidi', 'Andy King'] },
      { q: 'Against which team did Leicester City\'s title win become official after a 2-2 draw at Stamford Bridge?', answer: 'Tottenham Hotspur', options: ['Tottenham Hotspur', 'Chelsea', 'Arsenal', 'Manchester United'] },
      { q: 'Who was the captain of Leicester City who lifted the trophy?', answer: 'Wes Morgan', options: ['Wes Morgan', 'Jamie Vardy', 'Kaspar Schmeichel', 'Riyad Mahrez'] },
      { q: 'Which goalkeeper kept 15 clean sheets during the season?', answer: 'Kasper Schmeichel', options: ['Kasper Schmeichel', 'Ron-Robert Zieler', 'Eldar Lovic', 'Mark Schwarzer'] },
      { q: 'Who scored the opening goal in the 3-1 win at Manchester City that signaled Leicester were real contenders?', answer: 'Robert Huth', options: ['Robert Huth', 'Jamie Vardy', 'Riyad Mahrez', 'N\'Golo Kante'] },
      { q: 'What were the odds given at the start of the season for Leicester to win the league?', answer: '5000/1', options: ['1000/1', '2500/1', '5000/1', '10000/1'] },
      { q: 'Which stadium served as the home ground for Leicester City?', answer: 'King Power Stadium', options: ['King Power Stadium', 'Stamford Bridge', 'Old Trafford', 'Anfield'] },
    ],
  },
];

/**
 * Get all available historical scenarios
 */
export function getHistoricalScenarios() {
  return HISTORICAL_SCENARIOS.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    difficulty: s.difficulty,
    questionCount: s.questions.length,
  }));
}

/**
 * Get a specific scenario by ID
 */
export function getScenarioById(scenarioId) {
  return HISTORICAL_SCENARIOS.find(s => s.id === scenarioId) || null;
}

/**
 * Get questions for a scenario (without answers)
 */
export function getScenarioQuestions(scenarioId) {
  const scenario = getScenarioById(scenarioId);
  if (!scenario) return null;
  
  return scenario.questions.map(q => ({
    question: q.q,
    options: q.options,
  }));
}

/**
 * Process a scenario attempt and calculate score
 */
export async function processScenarioAttempt(fastify, userId, scenarioId, answers) {
  const scenario = getScenarioById(scenarioId);
  if (!scenario) {
    return { error: 'Scenario not found' };
  }

  let correctCount = 0;
  const results = [];

  for (let i = 0; i < scenario.questions.length; i++) {
    const question = scenario.questions[i];
    const userAnswer = answers[i];
    const isCorrect = userAnswer === question.answer;
    
    if (isCorrect) correctCount++;
    
    results.push({
      questionIndex: i,
      correct: isCorrect,
      correctAnswer: question.answer,
      userAnswer: userAnswer,
    });
  }

  const scorePercent = Math.round((correctCount / scenario.questions.length) * 100);
  const passed = scorePercent >= 80;

  // Store result in database
  try {
    await fastify.db.query(
      `INSERT INTO historical_scenario_results 
       (id, user_id, scenario_id, score_percent, correct_answers, total_questions, passed, answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, scenario_id) DO UPDATE SET
         score_percent = $4,
         correct_answers = $5,
         passed = $7,
         answers = $8,
         completed_at = NOW()`,
      [uuidv4(), userId, scenarioId, scorePercent, correctCount, scenario.questions.length, passed, JSON.stringify(answers)]
    );

    // Update mastery points
    if (passed) {
      await fastify.db.query(
        `UPDATE users SET 
           metadata = jsonb_set(metadata, '{mastery_points}', COALESCE((metadata->>'mastery_points')::int, 0) + 10::text)
         WHERE id = $1`,
        [userId]
      );
    }
  } catch (err) {
    fastify.log.error('Error storing scenario result:', err);
  }

  return {
    scenarioId,
    score: scorePercent,
    correctAnswers: correctCount,
    totalQuestions: scenario.questions.length,
    passed,
    results,
  };
}

/**
 * Get user's quest progress
 */
export async function getUserQuestProgress(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT * FROM user_quests WHERE user_id = $1`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    fastify.log.error('Error fetching quest progress:', err);
    return [];
  }
}

/**
 * Get daily quests for a user
 */
export async function getDailyQuests(fastify, userId) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Get user's completed quests today
    const completedResult = await fastify.db.query(
      `SELECT quest_id FROM user_quests 
       WHERE user_id = $1 AND quest_type = 'daily' AND completed_at::date = $2`,
      [userId, today]
    );
    
    const completedIds = completedResult.rows.map(r => r.quest_id);
    
    return DAILY_QUESTS.map(quest => ({
      ...quest,
      completed: completedIds.includes(quest.id),
      reward: quest.reward,
    }));
  } catch (err) {
    fastify.log.error('Error fetching daily quests:', err);
    return DAILY_QUESTS.map(quest => ({ ...quest, completed: false }));
  }
}

/**
 * Get weekly quests for a user
 */
export async function getWeeklyQuests(fastify, userId) {
  const weekStart = getWeekStart();
  
  try {
    const completedResult = await fastify.db.query(
      `SELECT quest_id FROM user_quests 
       WHERE user_id = $1 AND quest_type = 'weekly' AND completed_at >= $2`,
      [userId, weekStart]
    );
    
    const completedIds = completedResult.rows.map(r => r.quest_id);
    
    return WEEKLY_QUESTS.map(quest => ({
      ...quest,
      completed: completedIds.includes(quest.id),
      reward: quest.reward,
    }));
  } catch (err) {
    fastify.log.error('Error fetching weekly quests:', err);
    return WEEKLY_QUESTS.map(quest => ({ ...quest, completed: false }));
  }
}

/**
 * Update quest progress
 */
export async function updateQuestProgress(fastify, userId, questType, questId, increment = 1) {
  try {
    await fastify.db.query(
      `INSERT INTO user_quests (id, user_id, quest_id, quest_type, progress, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5, false, NULL)
       ON CONFLICT (user_id, quest_id) DO UPDATE SET
         progress = user_quests.progress + $5`,
      [uuidv4(), userId, questId, questType, increment]
    );
    
    // Check if quest is now complete
    const result = await fastify.db.query(
      `SELECT progress FROM user_quests WHERE user_id = $1 AND quest_id = $2`,
      [userId, questId]
    );
    
    if (result.rows.length > 0) {
      const quest = [...DAILY_QUESTS, ...WEEKLY_QUESTS].find(q => q.id === questId);
      if (quest && result.rows[0].progress >= quest.requirement.count) {
        await fastify.db.query(
          `UPDATE user_quests SET completed = true, completed_at = NOW() 
           WHERE user_id = $1 AND quest_id = $2`,
          [userId, questId]
        );
        return { completed: true, quest };
      }
    }
    
    return { completed: false };
  } catch (err) {
    fastify.log.error('Error updating quest progress:', err);
    return { completed: false };
  }
}

/**
 * Get skill tree info
 */
export function getSkillTrees() {
  return [
    {
      id: 'premier_league',
      name: 'The Premier League Specialist',
      nodes: 4,
      levels: 20,
      capstoneReward: { badge: 'premier_league_legend', flair: 'gold_border' },
    },
    {
      id: 'serie_a',
      name: 'The Serie A Historian',
      nodes: 4,
      levels: 20,
      capstoneReward: { badge: 'calcio_king', flair: 'italian_tricolore' },
    },
    {
      id: 'ucl',
      name: 'The UCL Strategist',
      nodes: 4,
      levels: 20,
      capstoneReward: { badge: 'european_elite', flair: 'star_ball' },
    },
  ];
}

/**
 * Get user's mastery points
 */
export async function getUserMasteryPoints(fastify, userId) {
  try {
    const result = await fastify.db.query(
      `SELECT metadata->>'mastery_points' as mastery_points FROM users WHERE id = $1`,
      [userId]
    );
    return parseInt(result.rows[0]?.mastery_points || 0);
  } catch (err) {
    return 0;
  }
}

/**
 * Helper: Get start of week (Monday)
 */
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
}

export default {
  getHistoricalScenarios,
  getScenarioById,
  getScenarioQuestions,
  processScenarioAttempt,
  getUserQuestProgress,
  getDailyQuests,
  getWeeklyQuests,
  updateQuestProgress,
  getSkillTrees,
  getUserMasteryPoints,
};