import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import config from './config.js';
import dbPlugin from './plugins/db.js';
import dbMonitorPlugin from './plugins/dbMonitor.js';
import redisPlugin from './plugins/redis.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import tribeRoutes from './routes/tribes.js';
import leaderboardRoutes from './routes/leaderboard.js';
import battleRoutes from './routes/battles.js';
import soloRoutes from './routes/solo.js';
import achievementRoutes from './routes/achievements.js';
import leagueRoutes from './routes/leagues.js';
import leagueSystemRoutes from './routes/leagueSystem.js';
import tribeWarRoutes from './routes/tribeWars.js';
import waitlistRoutes from './routes/waitlist.js';
import collectibleRoutes from './routes/collectibles.js';
import paymentsRoutes from './routes/payments.js';
import wc2026Routes from './routes/wc2026.js';
import africanGiantsRoutes from './routes/africanGiants.js';
import referralRoutes from './routes/referrals.js';
import governanceRoutes from './routes/governance.js';
import statusRoutes from './routes/status.js';
import iqProfileRoutes from './routes/iqProfile.js';
import prestigeRoutes from './routes/prestige.js';
import relayRoutes from './routes/relay.js';
import shopRoutes from './routes/shop.js';
import { setupBattleHandlers } from './services/battleService.js';
import { setupRelayHandlers } from './services/relayService.js';
import { setupTournamentHandlers } from './services/tournamentLeaderboardService.js';
import { setupMatchmakingHandlers, startMatchmakingPolling } from './services/matchmakingService.js';
import { startBackgroundJobs } from './services/backgroundJobs.js';

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(jwt, {
  secret: config.jwt.secret,
  sign: { expiresIn: '1h' },
});

await fastify.register(rateLimit, {
  max: 10000,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.user?.id || request.ip,
  skip: (request) => request.url === '/health',
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
});

// Initialize database connection
fastify.register(dbPlugin);

// Database pool monitoring (after dbPlugin since it uses fastify.db)
fastify.register(dbMonitorPlugin);

// Initialize Redis connection
fastify.register(redisPlugin);

// Health check
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// API routes
await fastify.register(authRoutes, { prefix: '/auth' });
await fastify.register(userRoutes, { prefix: '/users' });
await fastify.register(tribeRoutes, { prefix: '/tribes' });
await fastify.register(leaderboardRoutes, { prefix: '/leaderboard' });
await fastify.register(battleRoutes, { prefix: '/battles' });
await fastify.register(soloRoutes, { prefix: '/solo' });
await fastify.register(achievementRoutes, { prefix: '/achievements' });
await fastify.register(leagueRoutes, { prefix: '/leagues' });
await fastify.register(leagueSystemRoutes, { prefix: '/leagues' });
await fastify.register(tribeWarRoutes, { prefix: '/tribe-wars' });
await fastify.register(waitlistRoutes, { prefix: '/waitlist' });
await fastify.register(collectibleRoutes, { prefix: '/collectibles' });
await fastify.register(paymentsRoutes, { prefix: '/payments' });
await fastify.register(wc2026Routes, { prefix: '/wc2026' });
await fastify.register(africanGiantsRoutes, { prefix: '/african-giants' });
await fastify.register(referralRoutes, { prefix: '/referrals' });
await fastify.register(governanceRoutes, { prefix: '/governance' });
await fastify.register(statusRoutes, { prefix: '/status' });
await fastify.register(iqProfileRoutes, { prefix: '/users' });
await fastify.register(prestigeRoutes, { prefix: '/users' });
await fastify.register(relayRoutes, { prefix: '/relay' });
await fastify.register(shopRoutes, { prefix: '/shop' });
await fastify.register(shopRoutes, { prefix: '/payments' });

// Socket.IO setup for real-time battles
const io = new Server(fastify.server, {
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Set up Redis adapter for Socket.IO cross-server broadcasts
const pubClient = fastify.redis.duplicate();
const subClient = fastify.redis.duplicate();
io.adapter(createAdapter(pubClient, subClient));
fastify.log.info('Socket.IO Redis adapter initialized');

// Namespace for battle events
const battleNamespace = io.of('/battle');
setupBattleHandlers(battleNamespace, fastify);

// Namespace for matchmaking
const matchmakingNamespace = io.of('/matchmaking');
setupMatchmakingHandlers(matchmakingNamespace, fastify);
startMatchmakingPolling(fastify, matchmakingNamespace);

// Namespace for Relay
const relayNamespace = io.of('/relay');
setupRelayHandlers(relayNamespace, fastify);

// Namespace for Tournament
const tournamentNamespace = io.of('/tournament');
setupTournamentHandlers(tournamentNamespace, fastify);

fastify.log.info('Socket.IO servers initialized');

// Namespace for WC2026 real-time events (VAR battles, match activations)
// P0-6: WebSocket auth to prevent userId spoofing
const wc2026Namespace = io.of('/wc2026');
wc2026Namespace.on('connection', async (socket) => {
  fastify.log.info(`WC2026 client connected: ${socket.id}`);

  // Validate JWT token from handshake
  let userId = null;
  try {
    const token = socket.handshake.auth?.token || 
                  socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = await fastify.jwt.verify(token);
      userId = decoded.id;
    }
  } catch (err) {
    fastify.log.warn(`WC2026 WS: Invalid token from socket ${socket.id}`);
  }

  if (!userId) {
    socket.emit('error', { code: 'UNAUTHORIZED', message: 'Valid token required' });
    socket.disconnect();
    return;
  }

  socket.userId = userId;
  fastify.log.info(`WC2026 authenticated: user ${userId} (socket ${socket.id})`);

  socket.on('join:var', async (data) => {
    const { var_event_id } = data;
    // Validate var_event exists and user is eligible
    try {
      const result = await fastify.db.query(
        'SELECT id FROM wc2026_var_events WHERE id = $1 AND is_active = true',
        [var_event_id]
      );
      if (result.rows.length === 0) {
        socket.emit('error', { code: 'VAR_NOT_FOUND', message: 'VAR event not found or expired' });
        return;
      }
      socket.join(`var:${var_event_id}`);
      fastify.log.info(`User ${userId} joined VAR room: ${var_event_id}`);
    } catch (err) {
      socket.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to join VAR room' });
    }
  });

  socket.on('join:match', async (data) => {
    const { match_id } = data;
    try {
      const result = await fastify.db.query(
        'SELECT id FROM wc2026_matches WHERE id = $1 AND is_active = true',
        [match_id]
      );
      if (result.rows.length === 0) {
        socket.emit('error', { code: 'MATCH_NOT_FOUND', message: 'Match not found or not active' });
        return;
      }
      socket.join(`match:${match_id}`);
      fastify.log.info(`User ${userId} joined match room: ${match_id}`);
    } catch (err) {
      socket.emit('error', { code: 'INTERNAL_ERROR', message: 'Failed to join match room' });
    }
  });
});
// Root namespace for global events
io.on('connection', async (socket) => {
  fastify.log.info(`Global client connected: ${socket.id}`);
  
  // Send current milestone status
  const count = await fastify.redis.get('users:total_count');
  socket.emit('global:milestone_update', { totalUsers: parseInt(count || '0') });
  
  // Check if ritual is active
  const ritualActive = await fastify.redis.get('ritual:active');
  if (ritualActive) {
    const startTime = await fastify.redis.get('ritual:startTime');
    socket.emit('global:ritual_trigger', { 
      active: true, 
      theme: 'golden_fire',
      startTime: parseInt(startTime || Date.now()),
      endTime: parseInt(startTime || Date.now()) + 3600000 
    });
  }
});

fastify.decorate('io', io);

// Start server
const start = async () => {
  try {
    await fastify.listen({
      port: config.app.port,
      host: '0.0.0.0',
    });
    fastify.log.info(`GoalMind API server running on port ${config.app.port}`);
    fastify.log.info(`WebSocket server running on port ${config.app.port}`);

    // Seed Season 1 Leagues and Vanguard members
    const { seed5TierLeagues } = await import('./services/leagueSystemService.js');
    await seed5TierLeagues(fastify);

    // P0-5: Start background jobs (VAR cleanup, prediction validation)
    startBackgroundJobs(fastify);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export default fastify;
