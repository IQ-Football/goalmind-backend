import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MATCHMAKING_LUA = fs.readFileSync(path.join(__dirname, 'matchmaking.lua'), 'utf8');
import { BATTLE_STATES, isDailyBattleLimitReached, incrementDailyBattleCount } from './battleService.js';

// Note: matchmakingQueue and socketToUser are now handled primarily through Redis
// to support multi-node scaling. We keep local maps only for sockets on this instance.
const localSockets = new Map(); // socketId -> userId
const userToSocket = new Map(); // userId -> socketId

export function setupMatchmakingHandlers(matchmakingNamespace, fastify) {
  matchmakingNamespace.on('connection', async (socket) => {
    fastify.log.info(`Matchmaking client connected: ${socket.id}`);

    // P0-6: WebSocket auth to prevent userId spoofing
    let userId = null;
    try {
      const token = socket.handshake.auth?.token || 
                    socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = await fastify.jwt.verify(token);
        userId = decoded.id;
      }
    } catch (err) {
      fastify.log.warn(`Matchmaking WS: Invalid token from socket ${socket.id}`);
    }

    if (!userId) {
      socket.emit('matchmaking:error', { code: 'UNAUTHORIZED', message: 'Valid token required' });
      socket.disconnect();
      return;
    }

    socket.userId = userId;
    localSockets.set(socket.id, userId);
    userToSocket.set(userId, socket.id);

    // Store session info in Redis for cross-instance lookup
    await fastify.redis.hset(`session:${userId}`, 'socket_id', socket.id, 'instance_id', process.env.INSTANCE_ID || 'node-1');

    // matchmaking:join - Enter queue
    socket.on('matchmaking:join', async (data) => {
      try {
        const { elo, tribeId, sector } = data;
        
        if (!socket.userId) {
          socket.emit('matchmaking:error', {
            code: 'NOT_AUTHENTICATED',
            message: 'Please login to join matchmaking',
          });
          return;
        }

        // Check for daily usage limit
        const limitReached = await isDailyBattleLimitReached(fastify, socket.userId);
        if (limitReached) {
          socket.emit('matchmaking:error', {
            code: 'DAILY_LIMIT_REACHED',
            message: 'You have reached your daily limit of 5 battles. Upgrade to GoalMind Pro for unlimited access!',
          });
          return;
        }

        // Check if already in queue (check Redis)
        const existingElo = await fastify.redis.zscore('matchmaking:queue', socket.userId);
        if (existingElo !== null) {
          socket.emit('matchmaking:error', {
            code: 'ALREADY_IN_QUEUE',
            message: 'You are already in the matchmaking queue',
          });
          return;
        }

        // Fetch user cohort for priority matchmaking
        const userRes = await fastify.db.query('SELECT cohort FROM users WHERE id = $1', [socket.userId]);
        const cohort = userRes.rows[0]?.cohort;

        // Store additional info in Redis Hash
        const queueEntry = {
          socketId: socket.id,
          elo,
          tribeId,
          sector: sector || '',
          joinedAt: Date.now(),
          cohort: cohort || '',
        };
        await fastify.redis.hset(`matchmaking:entry:${socket.userId}`, queueEntry);

        // Add to Redis sorted sets for matchmaking
        await fastify.redis.zadd('matchmaking:queue', elo, socket.userId);
        await fastify.redis.zadd('matchmaking:waitlist', Date.now(), socket.userId);

        const position = await getQueuePosition(socket.userId);
        socket.emit('matchmaking:joined', {
          userId: socket.userId,
          elo,
          position,
        });

        // Try to find a match
        await findMatch(socket.userId, elo, fastify, matchmakingNamespace);

        fastify.log.info(`User ${socket.userId} joined matchmaking with Elo ${elo}`);
      } catch (err) {
        fastify.log.error(err);
        socket.emit('matchmaking:error', {
          code: 'INTERNAL_ERROR',
          message: 'Failed to join matchmaking',
        });
      }
    });

    // matchmaking:leave - Exit queue
    socket.on('matchmaking:leave', async () => {
      try {
        if (!socket.userId) return;

        await removeFromQueue(socket.userId, fastify);

        socket.emit('matchmaking:left', {
          userId: socket.userId,
        });

        fastify.log.info(`User ${socket.userId} left matchmaking queue`);
      } catch (err) {
        fastify.log.error(err);
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      fastify.log.info(`Matchmaking client disconnected: ${socket.id}`);
      
      if (socket.userId) {
        localSockets.delete(socket.id);
        userToSocket.delete(socket.userId);
        await removeFromQueue(socket.userId, fastify);
      }
    });
  });
}

// Remove user from matchmaking queue
async function removeFromQueue(userId, fastify) {
  await fastify.redis.zrem('matchmaking:queue', userId);
  await fastify.redis.zrem('matchmaking:waitlist', userId);
  await fastify.redis.del(`matchmaking:entry:${userId}`);
}

// Get user's position in queue
async function getQueuePosition(userId) {
  const rank = await fastify.redis.zrevrank('matchmaking:queue', userId);
  return rank !== null ? rank + 1 : null;
}

// Get opponent's socket ID from user ID
async function getOpponentSocketId(opponentId, fastify) {
  return await fastify.redis.hget(`session:${opponentId}`, 'socket_id');
}

// Successfully matched two users, finalize the battle
async function finalizeMatch(userId, opponentId, fastify, namespace) {
  try {
    // Get sector info from Redis entry for one of the users
    const sector = await fastify.redis.hget(`matchmaking:entry:${userId}`, 'sector');

    // Create battle in database
    const battleId = uuidv4();
    await fastify.db.query(
      `INSERT INTO battles (id, player1_id, player2_id, status, sector) 
       VALUES ($1, $2, $3, $4, $5)`,
      [battleId, userId, opponentId, BATTLE_STATES.PENDING, sector || null]
    );

    // Get opponent info
    const opponentResult = await fastify.db.query(
      'SELECT id, username, elo, tribe_id FROM users WHERE id = $1',
      [opponentId]
    );
    const opponent = opponentResult.rows[0];

    // Get current user's info
    const userResult = await fastify.db.query(
      'SELECT id, username, elo, tribe_id FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    // Store battleId in Redis for both users
    await fastify.redis.hset(`session:${userId}`, 'battle_id', battleId);
    await fastify.redis.hset(`session:${opponentId}`, 'battle_id', battleId);

    // Emit to both players
    const userSocketId = await fastify.redis.hget(`session:${userId}`, 'socket_id');
    const opponentSocketId = await fastify.redis.hget(`session:${opponentId}`, 'socket_id');

    if (userSocketId) {
      namespace.to(userSocketId).emit('matchmaking:found', {
        battleId,
        opponent: opponent ? {
          id: opponent.id,
          username: opponent.username,
          elo: opponent.elo,
        } : { id: opponentId, username: 'Opponent' },
        estimatedWaitMs: 0,
      });
    }

    if (opponentSocketId) {
      namespace.to(opponentSocketId).emit('matchmaking:found', {
        battleId,
        opponent: user ? {
          id: user.id,
          username: user.username,
          elo: user.elo,
        } : { id: userId, username: 'Opponent' },
        estimatedWaitMs: 0,
      });
    }

    fastify.log.info(`Match finalized: ${userId} vs ${opponentId} in battle ${battleId}`);
  } catch (err) {
    fastify.log.error(`Error finalizing match: ${err.message}`);
  }
}

// Find a match for a player
async function findMatch(userId, elo, fastify, namespace) {
  const queueEntryRaw = await fastify.redis.hgetall(`matchmaking:entry:${userId}`);
  if (!queueEntryRaw || Object.keys(queueEntryRaw).length === 0) return;

  const queueEntry = {
    ...queueEntryRaw,
    elo: parseInt(queueEntryRaw.elo),
    joinedAt: parseInt(queueEntryRaw.joinedAt),
  };

  const currentTime = Date.now();
  const timeInQueue = currentTime - queueEntry.joinedAt;
  const expansionCount = Math.floor(timeInQueue / config.matchmaking.expansionIntervalMs);
  
  // Calculate Elo range (expands every 10 seconds)
  const eloRange = config.matchmaking.eloRangeInitial + 
    (config.matchmaking.eloRangeExpansion * expansionCount);

  const minElo = elo - eloRange;
  const maxElo = elo + eloRange;

  // Get potential opponents from Redis (limited to 10 for performance)
  const opponents = await fastify.redis.zrangebyscore(
    'matchmaking:queue',
    minElo,
    maxElo,
    'LIMIT', 0, 10
  );

  // Filter out self
  let eligibleOpponents = opponents.filter(oppId => oppId !== userId);

  // Implement Priority Pool logic for Vanguard 500
  // Spec: Vanguard 500 users get priority access for 5 seconds before falling back to the standard pool.
  if (queueEntry.cohort === 'vanguard_500' && timeInQueue < 5000) {
    // Only match with other Vanguard 500 users in the first 5 seconds
    const opponentCohorts = await Promise.all(
      eligibleOpponents.map(async (oppId) => {
        const cohort = await fastify.redis.hget(`matchmaking:entry:${oppId}`, 'cohort');
        return { id: oppId, cohort };
      })
    );
    eligibleOpponents = opponentCohorts
      .filter(opp => opp.cohort === 'vanguard_500')
      .map(opp => opp.id);
  }

  if (eligibleOpponents.length > 0) {
    // Pick the first eligible opponent
    const opponentId = eligibleOpponents[0];
    
    // Attempt to atomically remove both from queue to prevent double matching
    const removed1 = await fastify.redis.zrem('matchmaking:queue', userId);
    const removed2 = await fastify.redis.zrem('matchmaking:queue', opponentId);

    if (removed1 === 0 || removed2 === 0) {
      // Someone else got one of them first
      if (removed1) await fastify.redis.zadd('matchmaking:queue', elo, userId);
      if (removed2) {
         const oppEloRaw = await fastify.redis.hget(`matchmaking:entry:${opponentId}`, 'elo');
         await fastify.redis.zadd('matchmaking:queue', parseInt(oppEloRaw) || 1000, opponentId);
      }
      return;
    }

    // Successfully "claimed" both users
    await fastify.redis.del(`matchmaking:entry:${userId}`);
    await fastify.redis.del(`matchmaking:entry:${opponentId}`);

    await finalizeMatch(userId, opponentId, fastify, namespace);
  } else {
    // No match found - check for timeout
    if (timeInQueue >= config.matchmaking.timeoutMs) {
      await removeFromQueue(userId, fastify);

      namespace.emit('matchmaking:timeout', {
        userId,
        message: 'No opponents found. Try again later or challenge a friend!',
      });
      
      fastify.log.info(`Matchmaking timeout for user ${userId}`);
    } else {
      // Update position and estimated wait time
      const position = await getQueuePosition(userId);
      namespace.emit('matchmaking:status', {
        position: position || 0,
        estimatedWaitMs: Math.max(0, config.matchmaking.timeoutMs - timeInQueue),
      });
    }
  }
}

// Start periodic polling for matchmaking
export function startMatchmakingPolling(fastify, namespace) {
  // Poll every 2 seconds for new matches
  setInterval(async () => {
    try {
      // Execute high-performance Lua script for matching
      // Arguments: queue_elo_key, queue_time_key, entries_prefix, current_time, elo_range_initial, elo_range_expansion, expansion_interval, vanguard_priority_ms
      const matches = await fastify.redis.eval(
        MATCHMAKING_LUA,
        2,
        'matchmaking:queue',
        'matchmaking:waitlist',
        'matchmaking:entry:',
        Date.now(),
        config.matchmaking.eloRangeInitial,
        config.matchmaking.eloRangeExpansion,
        config.matchmaking.expansionIntervalMs,
        5000 // Vanguard priority window (5 seconds)
      );

      // Process matches returned by the script
      if (matches && matches.length > 0) {
        fastify.log.info(`Lua matchmaking found ${matches.length / 2} matches`);
        for (let i = 0; i < matches.length; i += 2) {
          const user1Id = matches[i];
          const user2Id = matches[i+1];
          
          // finalizeMatch handles DB battle creation and socket notifications
          await finalizeMatch(user1Id, user2Id, fastify, namespace);
        }
      }
    } catch (err) {
      fastify.log.error('Matchmaking polling error:', err);
    }
  }, 2000);
}

export default {
  setupMatchmakingHandlers,
  startMatchmakingPolling,
};
