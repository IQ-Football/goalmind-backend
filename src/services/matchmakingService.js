import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
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

        // Add to Redis sorted set for matchmaking
        await fastify.redis.zadd('matchmaking:queue', elo, socket.userId);

        const position = await getQueuePosition(socket.userId);
        socket.emit('matchmaking:joined', {
          userId: socket.userId,
          elo,
          position,
          sector
        });

        // Try to find a match
        await findMatch(socket.userId, elo, fastify, matchmakingNamespace);

        fastify.log.info(`User ${socket.userId} joined matchmaking with Elo ${elo} in sector ${sector}`);
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
        socketToUser.delete(socket.id);
        await removeFromQueue(socket.userId, fastify);
      }
    });
  });
}

// Remove user from matchmaking queue
async function removeFromQueue(userId, fastify) {
  await fastify.redis.zrem('matchmaking:queue', userId);
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

  // Get potential opponents from Redis
  const opponents = await fastify.redis.zrangebyscore(
    'matchmaking:queue',
    minElo,
    maxElo
  );

  // Filter out self
  let eligibleOpponents = opponents.filter(oppId => oppId !== userId);

  // Implement Sector-based matching for Imperial Conflict
  // Users in a sector should ideally match with others in the SAME sector
  if (queueEntry.sector) {
    const pipeline = fastify.redis.pipeline();
    eligibleOpponents.forEach(oppId => {
      pipeline.hget(`matchmaking:entry:${oppId}`, 'sector');
    });
    const sectorResults = await pipeline.exec();
    
    const opponentSectors = eligibleOpponents.map((oppId, idx) => ({
      id: oppId,
      sector: sectorResults[idx][1]
    }));
    
    const sameSectorOpponents = opponentSectors
      .filter(opp => opp.sector === queueEntry.sector)
      .map(opp => opp.id);
      
    if (sameSectorOpponents.length > 0) {
      eligibleOpponents = sameSectorOpponents;
    }
  }

  // Implement Priority Pool logic for Vanguard 500
  if (queueEntry.cohort === 'vanguard_500' && timeInQueue < 5000) {
    const pipeline = fastify.redis.pipeline();
    eligibleOpponents.forEach(oppId => {
      pipeline.hget(`matchmaking:entry:${oppId}`, 'cohort');
    });
    const cohortResults = await pipeline.exec();
    
    const opponentCohorts = eligibleOpponents.map((oppId, idx) => ({
      id: oppId,
      cohort: cohortResults[idx][1]
    }));

    eligibleOpponents = opponentCohorts
      .filter(opp => opp.cohort === 'vanguard_500')
      .map(opp => opp.id);
  }

  if (eligibleOpponents.length > 0) {
    // Pick the first eligible opponent
    const opponentId = eligibleOpponents[0];
    
    // Attempt to atomically remove both from queue to prevent double matching
    // In a production app, use a Lua script for true atomicity
    const removed1 = await fastify.redis.zrem('matchmaking:queue', userId);
    const removed2 = await fastify.redis.zrem('matchmaking:queue', opponentId);

    if (removed1 === 0 || removed2 === 0) {
      // Someone else got one of them first
      if (removed1) await fastify.redis.zadd('matchmaking:queue', elo, userId);
      if (removed2) {
         const oppElo = await fastify.redis.hget(`matchmaking:entry:${opponentId}`, 'elo');
         await fastify.redis.zadd('matchmaking:queue', oppElo || 1000, opponentId);
      }
      return;
    }

    // Successfully "claimed" both users
    await fastify.redis.del(`matchmaking:entry:${userId}`);
    await fastify.redis.del(`matchmaking:entry:${opponentId}`);

    // Create battle in database
    const battleId = uuidv4();
    await fastify.db.query(
      `INSERT INTO battles (id, player1_id, player2_id, status, sector) 
       VALUES ($1, $2, $3, $4, $5)`,
      [battleId, userId, opponentId, BATTLE_STATES.PENDING, queueEntry.sector]
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
    // Using namespace.to(socketId).emit() works across instances with Redis adapter
    const userSocketId = queueEntry.socketId;
    const opponentSocketId = await getOpponentSocketId(opponentId, fastify);

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

    fastify.log.info(`Match found: ${userId} (${elo}) vs ${opponentId} in battle ${battleId}`);
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
      // Get all users currently in the queue from Redis
      const usersInQueue = await fastify.redis.zrange('matchmaking:queue', 0, -1, 'WITHSCORES');
      
      // Optimized: use pipeline to fetch cohorts for all users in queue
      const pipeline = fastify.redis.pipeline();
      for (let i = 0; i < usersInQueue.length; i += 2) {
        pipeline.hget(`matchmaking:entry:${usersInQueue[i]}`, 'cohort');
      }
      const cohortResults = await pipeline.exec();
      
      const queueEntries = [];
      for (let i = 0; i < usersInQueue.length; i += 2) {
        const userId = usersInQueue[i];
        const elo = parseInt(usersInQueue[i+1]);
        const cohort = cohortResults[i/2][1];
        queueEntries.push({ userId, elo, cohort });
      }

      // Priority: process Vanguard 500 users first
      queueEntries.sort((a, b) => {
        if (a.cohort === 'vanguard_500' && b.cohort !== 'vanguard_500') return -1;
        if (a.cohort !== 'vanguard_500' && b.cohort === 'vanguard_500') return 1;
        return 0;
      });

      for (const entry of queueEntries) {
        await findMatch(entry.userId, entry.elo, fastify, namespace);
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
