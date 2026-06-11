import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { calculateTribePoints, recordTribalBattle, areTribesRivals } from './tribeWarScoring.js';
import { awardLeaguePoints } from './leagueSystemService.js';
import { getNationPointsMultiplier } from './surgeService.js';
import { getDerbyMultipliers } from './derbyService.js';
import { broadcastTournamentUpdate } from './tournamentLeaderboardService.js';
import { creditTokens, TRANSACTION_TYPES } from './goalTokenService.js';
import { recordWin as recordGizaWin } from './imperialConflictService.js';


// Battle state machine states
export const BATTLE_STATES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  ABANDONED: 'abandoned',
  COMPLETED: 'completed',
};

// Battle state TTL in Redis (seconds) — 1 hour max
const BATTLE_STATE_TTL = 3600;

// In-memory timers reference (not battle state — just round timers)
// Timers are per-server-instance and don't need Redis
const battleTimers = new Map();

// Redis key helpers
function battleKey(battleId) { return `battle:${battleId}:state`; }

/**
 * Get battle state from Redis
 * @returns {Object|null} Battle state or null if not found
 */
async function getBattleState(battleId, fastify) {
  const data = await fastify.redis.hgetall(battleKey(battleId));
  if (!data || Object.keys(data).length === 0) return null;
  return {
    id: battleId,
    player1_id: data.player1_id,
    player2_id: data.player2_id,
    status: data.status,
    sector: data.sector || null,
    player1_score: parseInt(data.player1_score || '0'),
    player2_score: parseInt(data.player2_score || '0'),
    player1_streak: parseInt(data.player1_streak || '0'),
    player2_streak: parseInt(data.player2_streak || '0'),
    current_round: parseInt(data.current_round || '0'),
    player1_answers: data.player1_answers ? JSON.parse(data.player1_answers) : [],
    player2_answers: data.player2_answers ? JSON.parse(data.player2_answers) : [],
    startTime: parseInt(data.startTime || '0'),
  };
}

/**
 * Set battle state in Redis (full replace)
 */
async function setBattleState(battleId, state, fastify) {
  await fastify.redis.hset(battleKey(battleId), {
    player1_id: state.player1_id,
    player2_id: state.player2_id,
    status: state.status,
    sector: state.sector || '',
    player1_score: String(state.player1_score || 0),
    player2_score: String(state.player2_score || 0),
    player1_streak: String(state.player1_streak || 0),
    player2_streak: String(state.player2_streak || 0),
    current_round: String(state.current_round || 0),
    player1_answers: JSON.stringify(state.player1_answers || []),
    player2_answers: JSON.stringify(state.player2_answers || []),
    startTime: String(state.startTime || 0),
  });
  await fastify.redis.expire(battleKey(battleId), BATTLE_STATE_TTL);
}

/**
 * Update specific fields in battle state (partial update)
 */
async function updateBattleField(battleId, field, value, fastify) {
  await fastify.redis.hset(battleKey(battleId), field, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/**
 * Delete battle state from Redis
 */
async function deleteBattleState(battleId, fastify) {
  await fastify.redis.del(battleKey(battleId));
}

/**
 * Check if a user has reached their daily battle limit
 * @returns {Promise<boolean>} true if limit reached, false otherwise
 */
export async function isDailyBattleLimitReached(fastify, userId) {
  // 1. Check if user is Pro
  const userResult = await fastify.db.query('SELECT is_pro, battle_tokens FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];
  
  if (user?.is_pro) {
    return false; // Pro users have unlimited battles
  }

  // 2. Check if user has Battle Tokens (energy)
  if (user && user.battle_tokens > 0) {
    return false;
  }

  // 3. Fallback to daily battle count from Redis if tokens are 0
  const today = new Date().toISOString().split('T')[0];
  const count = await fastify.redis.get(`user:${userId}:battles_count:${today}`);
  
  return parseInt(count || '0') >= config.battle.freeTierDailyLimit;
}

/**
 * Get daily battle stats for a user
 */
export async function getDailyBattleStats(fastify, userId) {
  const userResult = await fastify.db.query('SELECT is_pro, battle_tokens FROM users WHERE id = $1', [userId]);
  const isPro = userResult.rows[0]?.is_pro || false;
  const battleTokens = userResult.rows[0]?.battle_tokens || 0;
  
  const today = new Date().toISOString().split('T')[0];
  const count = await fastify.redis.get(`user:${userId}:battles_count:${today}`);
  
  return {
    battlesToday: parseInt(count || '0'),
    dailyLimit: isPro ? null : config.battle.freeTierDailyLimit,
    isPro,
    remainingBattles: isPro ? null : Math.max(0, config.battle.freeTierDailyLimit - parseInt(count || '0')),
    battleTokens,
  };
}

/**
 * Increment daily battle count for a user
 */
export async function incrementDailyBattleCount(fastify, userId) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Deduct a Battle Token if the user is not Pro (Row-level lock for stability)
    const userResult = await client.query('SELECT is_pro, battle_tokens FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = userResult.rows[0];

    if (user && !user.is_pro && user.battle_tokens > 0) {
      await client.query('UPDATE users SET battle_tokens = battle_tokens - 1 WHERE id = $1', [userId]);
    }
    
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error({ err, userId }, 'Failed to deduct battle token');
    // Continue anyway to record the count in Redis
  } finally {
    client.release();
  }

  // 2. Also increment the Redis counter for legacy/stats tracking
  const today = new Date().toISOString().split('T')[0];
  const key = `user:${userId}:battles_count:${today}`;
  const count = await fastify.redis.incr(key);
  await fastify.redis.expire(key, 86400 * 2); // 2 days TTL to be safe

  // 3. Award Daily 3 Loop bonus if exactly 3 battles played today
  if (count === 3) {
    try {
      await creditTokens(fastify, {
        userId,
        amount: 50,
        type: TRANSACTION_TYPES.DAILY_3_LOOP,
        referenceId: `daily3:${userId}:${today}`
      });
      fastify.log.info({ userId }, 'Awarded Daily 3 Loop bonus');
    } catch (err) {
      fastify.log.error({ err, userId }, 'Failed to award Daily 3 Loop bonus');
    }
  }
}

export function setupBattleHandlers(battleNamespace, fastify) {
  battleNamespace.on('connection', async (socket) => {
    fastify.log.info(`Battle client connected: ${socket.id}`);

    // --- FIX P0-6: WebSocket Auth — validate userId from JWT, prevent spoofing ---
    let userId = null;
    try {
      // Authenticate WebSocket connection using JWT from handshake auth token
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = await fastify.jwt.verify(token);
        userId = decoded.id;
      }
    } catch (err) {
      fastify.log.warn(`Battle WS: Invalid token from socket ${socket.id}`);
    }

    if (!userId) {
      socket.emit('battle:error', {
        code: 'UNAUTHORIZED',
        message: 'Valid authentication token required',
      });
      socket.disconnect();
      return;
    }

    socket.userId = userId;
    // Store session mapping in Redis
    await fastify.redis.hset(`session:${userId}`, 'socket_id', socket.id);

    // battle:join - Join a battle that's ready to start
    socket.on('battle:join', async (data) => {
      try {
        const { battleId } = data;
        
        // Get battle from database
        const result = await fastify.db.query(
          'SELECT * FROM battles WHERE id = $1 AND status IN ($2, $3)',
          [battleId, BATTLE_STATES.PENDING, BATTLE_STATES.CONFIRMED]
        );
        
        if (result.rows.length === 0) {
          socket.emit('battle:error', {
            code: 'BATTLE_NOT_FOUND',
            message: 'Battle does not exist or has already ended',
          });
          return;
        }
        
        const battle = result.rows[0];
        
        // Verify this user is a participant (using validated userId from token)
        if (battle.player1_id !== userId && battle.player2_id !== userId) {
          socket.emit('battle:error', {
            code: 'NOT_PARTICIPANT',
            message: 'You are not part of this battle',
          });
          return;
        }

        // Join the socket room
        socket.join(`battle:${battleId}`);
        socket.battleId = battleId;
        socket.battleData = battle;

        // Increment daily battle count for THIS user (with deduplication for reconnects)
        const hasBeenCounted = await fastify.redis.sismember(`battle:${battleId}:participants_counted`, userId);
        if (!hasBeenCounted) {
          await incrementDailyBattleCount(fastify, userId);
          await fastify.redis.sadd(`battle:${battleId}:participants_counted`, userId);
          await fastify.redis.expire(`battle:${battleId}:participants_counted`, 3600);
        }

        // Get opponent info
        const opponentId = battle.player1_id === userId 
          ? battle.player2_id 
          : battle.player1_id;
        
        const opponentResult = await fastify.db.query(
          'SELECT id, username, elo, tribe_id FROM users WHERE id = $1',
          [opponentId]
        );
        
        const opponent = opponentResult.rows[0] || { id: opponentId, username: 'Opponent' };

        // Update battle status to confirmed and get questions
        if (battle.status === BATTLE_STATES.PENDING) {
          await fastify.db.query(
            `UPDATE battles SET status = $1, started_at = NOW() WHERE id = $2`,
            [BATTLE_STATES.CONFIRMED, battleId]
          );
          battle.status = BATTLE_STATES.CONFIRMED;
        }

        // Select 5 random questions for the battle
        const questionsResult = await fastify.db.query(
          `SELECT id, content, options, difficulty, category 
           FROM questions 
           ORDER BY RANDOM() 
           LIMIT ${config.battle.totalRounds}`,
          []
        );

        if (questionsResult.rows.length < config.battle.totalRounds) {
          socket.emit('battle:error', {
            code: 'INSUFFICIENT_QUESTIONS',
            message: 'Not enough questions available for battle',
          });
          return;
        }

        const questions = questionsResult.rows.map(q => ({
          id: q.id,
          content: q.content,
          options: q.options,
          difficulty: q.difficulty,
          category: q.category,
        }));

        // Initialize battle state in Redis
        const battleState = {
          id: battleId,
          player1_id: battle.player1_id,
          player2_id: battle.player2_id,
          status: BATTLE_STATES.IN_PROGRESS,
          player1_score: 0,
          player2_score: 0,
          player1_streak: 0,
          player2_streak: 0,
          current_round: 0,
          player1_answers: [],
          player2_answers: [],
          startTime: Date.now(),
        };
        
        await setBattleState(battleId, battleState, fastify);

        // Store questions in Redis for validation later
        await fastify.redis.set(
          `battle:${battleId}:questions`,
          JSON.stringify(questions),
          'EX',
          600 // 10 min expiry
        );

        // Emit battle start to both players
        const firstQuestion = questions[0];
        battleNamespace.to(`battle:${battleId}`).emit('battle:start', {
          battleId,
          opponent: {
            id: opponent.id,
            username: opponent.username,
            elo: opponent.elo,
          },
          questions: questions.map(q => ({
            id: q.id,
            content: q.content,
            options: q.options,
            difficulty: q.difficulty,
            category: q.category,
          })),
          firstQuestion: {
            id: firstQuestion.id,
            content: firstQuestion.content,
            options: firstQuestion.options,
            timeLimitMs: config.battle.roundTimeMs,
            roundNumber: 1,
          },
        });

        // Start first round timer
        startRoundTimer(battleId, battleNamespace, fastify);

        fastify.log.info(`Battle ${battleId} started with ${questions.length} questions`);
      } catch (err) {
        fastify.log.error(err);
        socket.emit('battle:error', {
          code: 'INTERNAL_ERROR',
          message: 'Failed to join battle',
        });
      }
    });

    // battle:answer - Submit an answer
    socket.on('battle:answer', async (data) => {
      try {
        const { battleId, questionId, answer, responseTimeMs } = data;
        
        if (!socket.battleId || socket.battleId !== battleId) {
          socket.emit('battle:error', {
            code: 'INVALID_BATTLE',
            message: 'You are not in this battle',
          });
          return;
        }

        // Anti-cheat: validate response time
        if (responseTimeMs < config.battle.minResponseTimeMs) {
          fastify.log.warn(`Battle ${battleId}: Suspiciously fast response from ${userId}`);
          // Don't reject, just log and continue
        }

        const battle = await getBattleState(battleId, fastify);
        if (!battle || battle.status !== BATTLE_STATES.IN_PROGRESS) {
          socket.emit('battle:error', {
            code: 'BATTLE_NOT_ACTIVE',
            message: 'Battle is not currently active',
          });
          return;
        }

        // Check if this player already answered this round
        const isPlayer1 = battle.player1_id === userId;
        const currentRoundAnswers = isPlayer1 ? battle.player1_answers : battle.player2_answers;
        
        if (currentRoundAnswers.includes(questionId)) {
          socket.emit('battle:error', {
            code: 'ALREADY_ANSWERED',
            message: 'You have already answered this question',
          });
          return;
        }

        // Validate answer against correct answer from Redis
        const questionsJson = await fastify.redis.get(`battle:${battleId}:questions`);
        const questions = JSON.parse(questionsJson);
        const question = questions.find(q => q.id === questionId);
        
        if (!question) {
          socket.emit('battle:error', {
            code: 'INVALID_QUESTION',
            message: 'Question not found',
          });
          return;
        }

        const isCorrect = answer === question.options[question.correct_option_index];
        
        // Calculate points with streak bonus
        const streak = isPlayer1 ? battle.player1_streak : battle.player2_streak;
        const pointsEarned = calculatePoints(responseTimeMs, isCorrect, streak);
        
        // Update streak in Redis
        let newStreak = isCorrect ? streak + 1 : 0;
        if (isPlayer1) {
          await updateBattleField(battleId, 'player1_streak', String(newStreak), fastify);
        } else {
          await updateBattleField(battleId, 'player2_streak', String(newStreak), fastify);
        }

        // Store answer
        const playerField = isPlayer1 ? 'player1_answers' : 'player2_answers';
        const newAnswers = [...currentRoundAnswers, questionId];
        await updateBattleField(battleId, playerField, JSON.stringify(newAnswers), fastify);

        // Update running score
        if (isPlayer1) {
          await updateBattleField(battleId, 'player1_score', String(battle.player1_score + pointsEarned), fastify);
        } else {
          await updateBattleField(battleId, 'player2_score', String(battle.player2_score + pointsEarned), fastify);
        }

        // Store answer in Redis for cross-check
        await fastify.redis.hset(
          `battle:${battleId}:answers`,
          `${userId}:${questionId}`,
          JSON.stringify({ answer, responseTimeMs, isCorrect, pointsEarned })
        );

        // Get updated score for acknowledgment
        const updatedBattle = await getBattleState(battleId, fastify);
        const runningScore = isPlayer1 ? updatedBattle.player1_score : updatedBattle.player2_score;

        // Emit acknowledgment to sender
        socket.emit('battle:answer_received', {
          questionId,
          correct: isCorrect,
          pointsEarned,
          responseTimeMs,
          runningScore,
        });

        fastify.log.info(`Battle ${battleId}: User ${userId} answered Q${questionId} - ${isCorrect ? 'CORRECT' : 'WRONG'} (+${pointsEarned})`);

        // Check if both players have answered
        await checkRoundComplete(battleId, battleNamespace, fastify);
      } catch (err) {
        fastify.log.error(err);
        socket.emit('battle:error', {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process answer',
        });
      }
    });

    // battle:emoji - Trash talk
    socket.on('battle:emoji', async (data) => {
      const { battleId, emojiType } = data;
      
      if (!socket.battleId || socket.battleId !== battleId) {
        return;
      }

      // Broadcast emoji to opponent
      const battle = await getBattleState(battleId, fastify);
      if (battle) {
        socket.to(`battle:${battleId}`).emit('battle:emoji', {
          from: userId,
          emojiType,
        });
      }
    });

    // battle:forfeit - Give up
    socket.on('battle:forfeit', async (data) => {
      const { battleId } = data;
      
      if (!socket.battleId || socket.battleId !== battleId) {
        return;
      }

      await handleBattleEnd(battleId, userId, true, battleNamespace, fastify);
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      fastify.log.info(`Battle client disconnected: ${socket.id}`);
      
      // Clean up session
      if (userId) {
        await fastify.redis.del(`session:${userId}`);
      }

      // Handle disconnect during active battle
      if (socket.battleId) {
        await handleBattleEnd(socket.battleId, userId, true, battleNamespace, fastify);
      }
    });
  });
}

// Start timer for a round
function startRoundTimer(battleId, namespace, fastify) {
  // Clear any existing timer
  if (battleTimers.has(battleId)) {
    clearTimeout(battleTimers.get(battleId));
  }

  const timer = setTimeout(async () => {
    await handleRoundTimeout(battleId, namespace, fastify);
  }, config.battle.roundTimeMs);

  battleTimers.set(battleId, timer);

  // Emit question (get battle state for current round info)
  getBattleState(battleId, fastify).then(async (battle) => {
    if (!battle) return;
    const questionsJson = await fastify.redis.get(`battle:${battleId}:questions`);
    const questions = JSON.parse(questionsJson);
    const question = questions[battle.current_round];
    namespace.to(`battle:${battleId}`).emit('battle:question', {
      questionId: question.id,
      question: question.content,
      options: question.options,
      timeLimitMs: config.battle.roundTimeMs,
      roundNumber: battle.current_round + 1,
    });
  });
}

// Handle round timeout (player didn't answer in time)
async function handleRoundTimeout(battleId, namespace, fastify) {
  const battle = await getBattleState(battleId, fastify);
  if (!battle || battle.status !== BATTLE_STATES.IN_PROGRESS) return;

  const questionsJson = await fastify.redis.get(`battle:${battleId}:questions`);
  const questions = JSON.parse(questionsJson);
  const currentQuestion = questions[battle.current_round];

  const player1Answered = battle.player1_answers.includes(currentQuestion.id);
  const player2Answered = battle.player2_answers.includes(currentQuestion.id);

  // If neither answered, skip round
  if (!player1Answered && !player2Answered) {
    fastify.log.info(`Battle ${battleId}: Round ${battle.current_round + 1} timeout - no answers`);
    // Move to next round
    await updateBattleField(battleId, 'current_round', String(battle.current_round + 1), fastify);
    
    const newBattle = await getBattleState(battleId, fastify);
    if (newBattle.current_round >= config.battle.totalRounds) {
      await handleBattleEnd(battleId, null, false, namespace, fastify);
    } else {
      // Inter-round delay then next question
      setTimeout(() => {
        startRoundTimer(battleId, namespace, fastify);
      }, config.battle.interRoundTimeMs);
    }
    return;
  }

  // Award 0 points to players who didn't answer in time
  // The round will be processed in checkRoundComplete when both have answered or timer fires
}

// Check if round is complete (both answered or time expired)
async function checkRoundComplete(battleId, namespace, fastify) {
  const battle = await getBattleState(battleId, fastify);
  if (!battle) return;

  const questionsJson = await fastify.redis.get(`battle:${battleId}:questions`);
  const questions = JSON.parse(questionsJson);
  const currentQuestion = questions[battle.current_round];
  const player1Answered = battle.player1_answers.includes(currentQuestion.id);
  const player2Answered = battle.player2_answers.includes(currentQuestion.id);

  // Both answered - end round immediately
  if (player1Answered && player2Answered) {
    // Clear the timer
    if (battleTimers.has(battleId)) {
      clearTimeout(battleTimers.get(battleId));
    }

    // Get correct answer
    const question = questions[battle.current_round];
    const correctAnswer = question.options[question.correct_option_index];

    // Get answers from Redis
    const p1AnswerData = await fastify.redis.hget(
      `battle:${battleId}:answers`,
      `${battle.player1_id}:${currentQuestion.id}`
    );
    const p2AnswerData = await fastify.redis.hget(
      `battle:${battleId}:answers`,
      `${battle.player2_id}:${currentQuestion.id}`
    );

    const p1Data = p1AnswerData ? JSON.parse(p1AnswerData) : { pointsEarned: 0 };
    const p2Data = p2AnswerData ? JSON.parse(p2AnswerData) : { pointsEarned: 0 };

    // Emit round end
    namespace.to(`battle:${battleId}`).emit('battle:round_end', {
      questionId: currentQuestion.id,
      correctAnswer,
      player1Points: p1Data.pointsEarned || 0,
      player2Points: p2Data.pointsEarned || 0,
      player1RunningScore: battle.player1_score,
      player2RunningScore: battle.player2_score,
      roundNumber: battle.current_round + 1,
    });

    // Move to next round in Redis
    await updateBattleField(battleId, 'current_round', String(battle.current_round + 1), fastify);

    const updatedBattle = await getBattleState(battleId, fastify);
    if (updatedBattle.current_round >= config.battle.totalRounds) {
      // Battle complete
      await handleBattleEnd(battleId, null, false, namespace, fastify);
    } else {
      // Inter-round delay then next question
      setTimeout(() => {
        startRoundTimer(battleId, namespace, fastify);
      }, config.battle.interRoundTimeMs);
    }
  }
}

// Handle battle end
async function handleBattleEnd(battleId, forfeitBy, isForfeit, namespace, fastify) {
  let battle = await getBattleState(battleId, fastify);
  
  if (!battle) {
    // Battle might already be completed, fetch from DB
    const result = await fastify.db.query(
      'SELECT * FROM battles WHERE id = $1',
      [battleId]
    );
    if (result.rows.length === 0) return;
    battle = { ...result.rows[0] };
  }

  // Clear any timers
  if (battleTimers.has(battleId)) {
    clearTimeout(battleTimers.get(battleId));
    battleTimers.delete(battleId);
  }

  // Determine winner and calculate Elo changes
  const player1Id = battle.player1_id;
  const player2Id = battle.player2_id;
  
  // Get player stats
  const p1Result = await fastify.db.query(
    `SELECT u.id, u.elo, u.battles_played, u.battles_won, u.tribe_id, u.cohort, u.metadata, tm.is_vanguard_100,
            t.slug as tribe_slug,
            (SELECT l.tier FROM league_participants lp JOIN leagues l ON lp.league_id = l.id WHERE lp.user_id = u.id AND l.is_active = true LIMIT 1) as league_tier,
            EXISTS(SELECT 1 FROM user_achievements WHERE user_id = u.id AND achievement_id = '4b6c8914-87be-47ea-8942-d64e9a8f2765') as has_ares_surge
     FROM users u
     LEFT JOIN tribe_members tm ON u.id = tm.user_id
     LEFT JOIN tribes t ON u.tribe_id = t.id
     WHERE u.id = $1`,
    [player1Id]
  );
  const p2Result = await fastify.db.query(
    `SELECT u.id, u.elo, u.battles_played, u.battles_won, u.tribe_id, u.cohort, u.metadata, tm.is_vanguard_100,
            t.slug as tribe_slug,
            (SELECT l.tier FROM league_participants lp JOIN leagues l ON lp.league_id = l.id WHERE lp.user_id = u.id AND l.is_active = true LIMIT 1) as league_tier,
            EXISTS(SELECT 1 FROM user_achievements WHERE user_id = u.id AND achievement_id = '4b6c8914-87be-47ea-8942-d64e9a8f2765') as has_ares_surge
     FROM users u
     LEFT JOIN tribe_members tm ON u.id = tm.user_id
     LEFT JOIN tribes t ON u.tribe_id = t.id
     WHERE u.id = $1`,
    [player2Id]
  );

  if (p1Result.rows.length === 0 || p2Result.rows.length === 0) {
    fastify.log.error(`Battle ${battleId}: Could not find player stats`);
    return;
  }

  const p1 = p1Result.rows[0];
  const p2 = p2Result.rows[0];

  let winnerId = null;
  let p1EloChange = 0;
  let p2EloChange = 0;

  if (isForfeit && forfeitBy) {
    // Forfeit - opponent wins
    winnerId = forfeitBy === player1Id ? player2Id : player1Id;
    if (forfeitBy === player1Id) {
      p1EloChange = -30; // Penalty for forfeiting
      p2EloChange = +30; // Reward for opponent
    } else {
      p1EloChange = +30;
      p2EloChange = -30;
    }
  } else {
    // Regular end - determine winner by score
    if (battle.player1_score > battle.player2_score) {
      winnerId = player1Id;
    } else if (battle.player2_score > battle.player1_score) {
      winnerId = player2Id;
    }
    // Draw is possible

    // Calculate Elo changes
    if (winnerId) {
      const p1IsWinner = winnerId === player1Id;
      const p1Elo = calculateElo(p1.elo, p2.elo, p1.battles_played, p1IsWinner);
      const p2Elo = calculateElo(p2.elo, p1.elo, p2.battles_played, !p1IsWinner);
      p1EloChange = p1Elo - p1.elo;
      p2EloChange = p2Elo - p2.elo;

      // Calculate IQ Multipliers (Vanguard 100 = 1.20x, Vanguard 500 = 1.05x, Centurion = 1.02x)
      if (p1EloChange > 0) {
        let p1Multiplier = 1.0;
        if (p1.is_vanguard_100) p1Multiplier += 0.20;
        if (p1.cohort === 'vanguard_500') p1Multiplier += 0.05;
        if (p1.cohort === 'centurion') p1Multiplier += 0.02;

        // Centurion Bounty Multiplier (1.1x total extra if defeating Vanguard)
        if (p1.cohort === 'centurion' && p2.cohort === 'vanguard_500' && winnerId === player1Id) {
          p1Multiplier += 0.10;
        }

        // Season 1 Streak Buff: +5% IQ Gain
        const p1Buffs = p1.metadata?.buffs || {};
        if (p1Buffs.iq_gain_multiplier && p1Buffs.iq_gain_expires && new Date(p1Buffs.iq_gain_expires) > new Date()) {
          p1Multiplier += (parseFloat(p1Buffs.iq_gain_multiplier) - 1.0);
        }

        if (p1Multiplier > 1.0) p1EloChange = Math.round(p1EloChange * p1Multiplier);
      }

      if (p2EloChange > 0) {
        let p2Multiplier = 1.0;
        if (p2.is_vanguard_100) p2Multiplier += 0.20;
        if (p2.cohort === 'vanguard_500') p2Multiplier += 0.05;
        if (p2.cohort === 'centurion') p2Multiplier += 0.02;

        // Centurion Bounty Multiplier
        if (p2.cohort === 'centurion' && p1.cohort === 'vanguard_500' && winnerId === player2Id) {
          p2Multiplier += 0.10;
        }

        // Season 1 Streak Buff
        const p2Buffs = p2.metadata?.buffs || {};
        if (p2Buffs.iq_gain_multiplier && p2Buffs.iq_gain_expires && new Date(p2Buffs.iq_gain_expires) > new Date()) {
          p2Multiplier += (parseFloat(p2Buffs.iq_gain_multiplier) - 1.0);
        }

        if (p2Multiplier > 1.0) p2EloChange = Math.round(p2EloChange * p2Multiplier);
      }

      // --- Cairo Siege Derby Window ---
      // Reward: +50 IQ points for defeating a rival currently in a higher division.
      const isCairoDerby = (p1.tribe_slug === 'al-ahly' && p2.tribe_slug === 'zamalek') ||
                           (p1.tribe_slug === 'zamalek' && p2.tribe_slug === 'al-ahly');
      
      if (isCairoDerby) {
        if (winnerId === player1Id && p2.league_tier && p1.league_tier && p2.league_tier < p1.league_tier) {
          p1EloChange += 50;
        } else if (winnerId === player2Id && p1.league_tier && p2.league_tier && p1.league_tier < p2.league_tier) {
          p2EloChange += 50;
        }
      }
    }
  }

  // Calculate GoalToken (GT) yield
  // Spec: Win 20, Loss 5. Draw: 10.
  let p1GTAmount = (winnerId === player1Id) ? 20 : (winnerId === player2Id ? 5 : 10);
  let p2GTAmount = (winnerId === player2Id) ? 20 : (winnerId === player1Id ? 5 : 10);

  // Apply Derby Window GoalToken multipliers
  const derbyMultipliers = await getDerbyMultipliers(fastify);
  p1GTAmount = Math.round(p1GTAmount * derbyMultipliers.goal_tokens);
  p2GTAmount = Math.round(p2GTAmount * derbyMultipliers.goal_tokens);

  // --- Golden Lightning Multiplier (Ares Surge Badge) ---
  if (p1.has_ares_surge) p1GemsEarned = Math.round(p1GemsEarned * 1.2);
  if (p2.has_ares_surge) p2GemsEarned = Math.round(p2GemsEarned * 1.2);

  // --- Soweto Supremacy Derby Window ---
  // Reward: +10% GoalToken yield for all matches played during the weekend window.
  const isSowetoDerby = (p1.tribe_slug === 'kaizer-chiefs' && p2.tribe_slug === 'orlando-pirates') ||
                        (p1.tribe_slug === 'orlando-pirates' && p2.tribe_slug === 'kaizer-chiefs');
  const now = new Date();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6; // Sun=0, Sat=6

  if (isSowetoDerby && isWeekend) {
    p1GTAmount = Math.round(p1GTAmount * 1.1);
    p2GTAmount = Math.round(p2GTAmount * 1.1);
  }

  // Award GT via Ledger Service (handles Vanguard multipliers)
  await creditTokens(fastify, {
    userId: player1Id,
    amount: p1GTAmount,
    type: winnerId === player1Id ? TRANSACTION_TYPES.BATTLE_WIN : (winnerId === player2Id ? TRANSACTION_TYPES.BATTLE_LOSS : TRANSACTION_TYPES.BATTLE_DRAW),
    referenceId: battleId
  });

  await creditTokens(fastify, {
    userId: player2Id,
    amount: p2GTAmount,
    type: winnerId === player2Id ? TRANSACTION_TYPES.BATTLE_WIN : (winnerId === player1Id ? TRANSACTION_TYPES.BATTLE_LOSS : TRANSACTION_TYPES.BATTLE_DRAW),
    referenceId: battleId
  });

  // --- Kariakoo Derby Window ---
  // Reward: "City Master" title for the player with the most derby wins in Season 1.
  const isKariakooDerby = (p1.tribe_slug === 'simba-sc' && p2.tribe_slug === 'yanga-sc') ||
                          (p1.tribe_slug === 'yanga-sc' && p2.tribe_slug === 'simba-sc');
  if (isKariakooDerby && winnerId) {
    // Record win in Redis for Season 1 "City Master" tracking
    await fastify.redis.hincrby('season1:kariakoo_wins', winnerId, 1);
  }

  // Calculate tribe points (10 points per win, distributed)
  // Check if this is a rivalry battle for 2x multiplier
  let baseTribePoints = winnerId ? 10 : 5;
  
  // Get tribe slugs for rivalry check
  let tribe1Slug = p1.tribe_slug;
  let tribe2Slug = p2.tribe_slug;
  
  // Apply rivalry multiplier if applicable
  const tribePointsAwarded = calculateTribePoints(baseTribePoints, tribe1Slug, tribe2Slug);
  const winnerTribeId = winnerId === player1Id ? p1.tribe_id : p2.tribe_id;

  // Award Nation Points (Glory Points) with David vs. Goliath Multiplier
  let p1NationPoints = 0;
  let p2NationPoints = 0;
  let isDavidVsGoliath = false;

  if (winnerId) {
    const winnerIsP1 = winnerId === player1Id;
    const baseWinPoints = 25;
    let multiplier = 1.0;

    // Trigger: If a user's tribe is at least 50% smaller (total registered members) than their opponent's tribe.
    try {
      const tribeCounts = await fastify.db.query(
        'SELECT id, member_count FROM tribes WHERE id IN ($1, $2)',
        [p1.tribe_id, p2.tribe_id]
      );
      const p1Tribe = tribeCounts.rows.find(t => t.id === p1.tribe_id);
      const p2Tribe = tribeCounts.rows.find(t => t.id === p2.tribe_id);

      if (p1Tribe && p2Tribe) {
        const p1Count = parseInt(p1Tribe.member_count || 0);
        const p2Count = parseInt(p2Tribe.member_count || 0);

        if (winnerIsP1 && p1Count > 0 && p2Count > 0 && p1Count <= p2Count * 0.5) {
          multiplier = 1.25;
          isDavidVsGoliath = true;
        } else if (!winnerIsP1 && p1Count > 0 && p2Count > 0 && p2Count <= p1Count * 0.5) {
          multiplier = 1.25;
          isDavidVsGoliath = true;
        }
      }
    } catch (e) {
      fastify.log.error(`Battle ${battleId}: David vs Goliath check failed: ${e.message}`);
    }

    p1NationPoints = winnerIsP1 ? Math.round(baseWinPoints * multiplier) : 0;
    p2NationPoints = !winnerIsP1 ? Math.round(baseWinPoints * multiplier) : 0;
  } else {
    // Draw
    p1NationPoints = 10;
    p2NationPoints = 10;
  }

  // --- Surge Region Multiplier ---
  // Double Nation Points for specific tribes (Nigeria, Ghana, Morocco, UCT, Wits)
  p1NationPoints = Math.round(p1NationPoints * getNationPointsMultiplier(p1.tribe_slug));
  p2NationPoints = Math.round(p2NationPoints * getNationPointsMultiplier(p2.tribe_slug));

  // --- Imperial Conflict: Siege of Giza ---
  let gizaPPAwarded = 0;
  if (battle.sector && winnerId) {
    try {
      const winnerTribe = winnerId === player1Id ? p1 : p2;
      const gizaResult = await recordGizaWin(fastify, winnerId, winnerTribe.tribe_id, battle.sector);
      if (gizaResult) {
        gizaPPAwarded = gizaResult.pp;
        fastify.log.info({ battleId, sector: battle.sector, pp: gizaPPAwarded }, 'Imperial Conflict PP awarded');
      }
    } catch (e) {
      fastify.log.error(`Battle ${battleId}: Giza win recording failed: ${e.message}`);
    }
  }

  // Update battle in database
  await fastify.db.query(
    `UPDATE battles SET
       status = $1,
       winner_id = $2,
       player1_score = $3,
       player2_score = $4,
       player1_elo_change = $5,
       player2_elo_change = $6,
       tribe_points_awarded = $7,
       winner_tribe_id = $8,
       loser_tribe_id = $9,
       giza_pp_awarded = $10,
       ended_at = NOW()
     WHERE id = $11`,
    [
      isForfeit ? BATTLE_STATES.ABANDONED : BATTLE_STATES.COMPLETED,
      winnerId,
      battle.player1_score || 0,
      battle.player2_score || 0,
      p1EloChange,
      p2EloChange,
      tribePointsAwarded,
      winnerTribeId,
      winnerTribeId === p1.tribe_id ? p2.tribe_id : p1.tribe_id,
      gizaPPAwarded,
      battleId
    ]
  );

  // Update player stats including Nation Points
  await fastify.db.query(
    `UPDATE users SET
       elo = elo + $1,
       nation_points = COALESCE(nation_points, 0) + $2,
       battles_played = battles_played + 1,
       battles_won = battles_won + CASE WHEN id = $3 THEN 1 ELSE 0 END,
       last_active_at = NOW()
     WHERE id = $4`,
    [p1EloChange, p1NationPoints, winnerId, player1Id]
  );
  await fastify.db.query(
    `UPDATE users SET
       elo = elo + $1,
       nation_points = COALESCE(nation_points, 0) + $2,
       battles_played = battles_played + 1,
       battles_won = battles_won + CASE WHEN id = $3 THEN 1 ELSE 0 END,
       last_active_at = NOW()
     WHERE id = $4`,
    [p2EloChange, p2NationPoints, winnerId, player2Id]
  );

  // --- Season 1 Streak Rewards ---
  // 3 Wins: +5% IQ Gain for 2 hours.
  // 5 Wins: "On Fire" status (Visual flame in lobby).
  // 10 Wins: Rare "Centurion Sword" Battle Intro.
  if (winnerId) {
    const streak = await fastify.redis.incr(`user:${winnerId}:season1_win_streak`);
    await fastify.redis.expire(`user:${winnerId}:season1_win_streak`, 86400); // Reset after 24h of inactivity

    if (streak === 3) {
      // +5% IQ Gain for 2 hours
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await fastify.db.query(
        "UPDATE users SET metadata = jsonb_set(metadata, '{buffs, iq_gain_multiplier}', '1.05') WHERE id = $1",
        [winnerId]
      );
      await fastify.db.query(
        "UPDATE users SET metadata = jsonb_set(metadata, '{buffs, iq_gain_expires}', $1) WHERE id = $2",
        [JSON.stringify(expiresAt), winnerId]
      );
    } else if (streak === 5) {
      // "On Fire" status
      await fastify.db.query(
        "UPDATE users SET metadata = jsonb_set(metadata, '{visual_effects, on_fire}', 'true') WHERE id = $1",
        [winnerId]
      );
    } else if (streak === 10) {
      // Centurion Sword Battle Intro
      await fastify.db.query(
        "UPDATE users SET metadata = jsonb_set(metadata, '{assets, battle_intro}', '\"centurion_sword\"') WHERE id = $1",
        [winnerId]
      );
    }
  }

  // Reset streak for loser
  const loserId = winnerId ? (winnerId === player1Id ? player2Id : player1Id) : null;
  if (loserId) {
    await fastify.redis.del(`user:${loserId}:season1_win_streak`);
    // Optionally remove "On Fire" status if streak broken
    await fastify.db.query(
      "UPDATE users SET metadata = jsonb_set(metadata, '{visual_effects, on_fire}', 'false') WHERE id = $1",
      [loserId]
    );
  }


  // Update tribe points
  if (winnerTribeId) {
    await fastify.db.query(
      `UPDATE tribes SET total_points = total_points + $1 WHERE id = $2`,
      [tribePointsAwarded, winnerTribeId]
    );

    // Record tribal battle for scoring aggregation and rivalry alerts
    await recordTribalBattle(fastify, {
      battleId,
      winnerId,
      winnerTribeId,
      loserTribeId: winnerTribeId === p1.tribe_id ? p2.tribe_id : p1.tribe_id,
      winnerTribeSlug: tribe1Slug,
      loserTribeSlug: tribe2Slug,
      isRivalry: areTribesRivals(tribe1Slug, tribe2Slug),
      winnerCohort: winnerId === player1Id ? p1.cohort : p2.cohort,
      loserCohort: winnerId === player1Id ? p2.cohort : p1.cohort
    });
  }

  // Update Redis leaderboard
  await fastify.redis.zadd('leaderboard:global', p1.elo + p1EloChange, player1Id);
  await fastify.redis.zadd('leaderboard:global', p2.elo + p2EloChange, player2Id);
  
  if (winnerTribeId) {
    const tribeScore = await fastify.redis.zscore('leaderboard:tribal', winnerTribeId) || 0;
    await fastify.redis.zadd('leaderboard:tribal', parseInt(tribeScore) + tribePointsAwarded, winnerTribeId);
  }

  // Award League Points (LP) for battle result
  try {
    const p1LP = await awardLeaguePoints(fastify, player1Id, {
      isWin: winnerId === player1Id,
      isDraw: !winnerId,
      newElo: p1.elo + p1EloChange,
    });
    const p2LP = await awardLeaguePoints(fastify, player2Id, {
      isWin: winnerId === player2Id,
      isDraw: !winnerId,
      newElo: p2.elo + p2EloChange,
    });
    if (p1LP || p2LP) {
      namespace.to(`battle:${battleId}`).emit('league:lp_awarded', {
        player1LP: p1LP,
        player2LP: p2LP,
      });
    }
  } catch (lpErr) {
    fastify.log.error('LP award error:', lpErr.message);
  }

  // Emit battle end
  namespace.to(`battle:${battleId}`).emit('battle:end', {
    battleId,
    winnerId,
    finalScore: {
      player1: battle.player1_score || 0,
      player2: battle.player2_score || 0,
    },
    eloChange: {
      player1: p1EloChange,
      player2: p2EloChange,
    },
    newElo: {
      player1: p1.elo + p1EloChange,
      player2: p2.elo + p2EloChange,
    },
    nationPointsEarned: {
      player1: p1NationPoints,
      player2: p2NationPoints,
    },
    isDavidVsGoliath,
    badgeAssets: {
      davidVsGoliath: isDavidVsGoliath ? '/assets/badges/giant_killer_icon.png' : null
    },
    tribePointsEarned: winnerId ? tribePointsAwarded : 0,
  });

  // Broadcast tournament update
  if (winnerId) {
    broadcastTournamentUpdate(fastify, {
      type: 'battle_end',
      battleId,
      winnerId,
      tribeId: winnerTribeId,
      tribeSlug: winnerTribeId === p1.tribe_id ? p1.tribe_slug : p2.tribe_slug,
      points: tribePointsAwarded,
      nationPoints: winnerId === player1Id ? p1NationPoints : p2NationPoints
    }).catch(err => fastify.log.error('Tournament broadcast failed:', err));
  }

  // Cleanup Redis battle state
  await deleteBattleState(battleId, fastify);
  await fastify.redis.del(`battle:${battleId}:questions`);
  await fastify.redis.del(`battle:${battleId}:answers`);

  fastify.log.info(`Battle ${battleId} ended. Winner: ${winnerId || 'Draw'}. Elo: P1 ${p1EloChange >= 0 ? '+' : ''}${p1EloChange}, P2 ${p2EloChange >= 0 ? '+' : ''}${p2EloChange}`);
}

// Calculate points based on response time, correctness, and streak
export function calculatePoints(responseTimeMs, isCorrect, currentStreak) {
  if (!isCorrect) return 0;
  
  const basePoints = 1000;
  const speedBonus = Math.max(0, 1000 - Math.floor(responseTimeMs / 10));
  
  // Streak bonus: 0% → 10% → 25% → 50% (after 1, 2, 3 consecutive correct)
  let streakMultiplier = 1.0;
  if (currentStreak >= 3) {
    streakMultiplier = 1.5;
  } else if (currentStreak >= 2) {
    streakMultiplier = 1.25;
  } else if (currentStreak >= 1) {
    streakMultiplier = 1.1;
  }
  
  return Math.round((basePoints + speedBonus) * streakMultiplier);
}

// Get K-factor based on battles played
export function getKFactor(battlesPlayed) {
  if (battlesPlayed < config.elo.newPlayerBattleThreshold) {
    return config.elo.kFactorNewPlayer;
  } else if (battlesPlayed < config.elo.veteranBattleThreshold) {
    return config.elo.kFactorEstablished;
  } else {
    return config.elo.kFactorVeteran;
  }
}

// Calculate new Elo rating
export function calculateElo(myElo, opponentElo, myBattlesPlayed, isWin) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
  const actual = isWin ? 1 : 0;
  const k = getKFactor(myBattlesPlayed);
  
  return Math.round(myElo + k * (actual - expected));
}

export default {
  setupBattleHandlers,
  calculatePoints,
  getKFactor,
  calculateElo,
  BATTLE_STATES,
};
