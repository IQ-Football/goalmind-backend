/**
 * Streak & Status Routes — "No Idle Champions"
 * 
 * Endpoints:
 * GET  /status/me           — Full status report for authenticated user
 * GET  /status/streak       — Current user's streak info
 * POST /status/activity      — Record activity (called after battle completion)
 */

import { authenticate } from '../middleware/auth.js';
import {
  recordActivity,
  getUserStatusReport,
  runDailyDecayJob,
  startDecayScheduler,
} from '../services/streakDecayService.js';

const statusRoutes = async (fastify, options) => {

  // Start decay scheduler on first route registration
  let schedulerStarted = false;
  try { startDecayScheduler(fastify); schedulerStarted = true; } catch (e) { /* already started */ }

  // GET /status/me — Full status report (ELO, rank, streak, inactivity tier)
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      const report = await getUserStatusReport(fastify, userId);
      if (!report) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
      return reply.send({ success: true, data: report });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch status' } });
    }
  });

  // GET /status/streak — Current streak info
  fastify.get('/streak', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      const userResult = await fastify.db.query(
        'SELECT streak_days, last_active_at FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
      
      const { streak_days, last_active_at } = userResult.rows[0];
      const inactiveDays = last_active_at
        ? Math.floor((Date.now() - new Date(last_active_at)) / 86400000)
        : 999;
      
      const milestones = [
        { days: 7, label: 'Dedicated' },
        { days: 14, label: 'Consistent' },
        { days: 30, label: 'Fanatic' },
        { days: 90, label: 'Legend' },
      ];
      const nextMilestone = milestones.find(m => (streak_days || 0) < m.days);
      
      return reply.send({
        success: true,
        data: {
          currentStreak: streak_days || 0,
          lastActive: last_active_at,
          inactiveDays,
          nextMilestone: nextMilestone ? { days: nextMilestone.days, label: nextMilestone.label } : null,
          isActive: inactiveDays < 7,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch streak' } });
    }
  });

  // POST /status/activity — Record activity (called after battle end)
  fastify.post('/activity', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;
    try {
      const result = await recordActivity(fastify, userId);
      if (!result) {
        return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to record activity' } });
      }
      return reply.send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to record activity' } });
    }
  });

  // POST /status/trigger-ritual — Trigger 25k milestone ritual (admin only)
  fastify.post('/trigger-ritual', { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    try {
      const winnerId = '37fe2954-9ab2-4fa8-871e-519dc2e4a120'; // Hardcoded for this milestone
      const startTime = Date.now();
      
      // Store in Redis for new connections
      await fastify.redis.set('ritual:active', 'true', 'EX', 3600);
      await fastify.redis.set('ritual:startTime', startTime.toString(), 'EX', 3600);

      // Emit to all namespaces
      fastify.io.emit('global:milestone_update', { totalUsers: 25091 });
      fastify.io.emit('global:ritual_trigger', { 
        active: true,
        theme: 'golden_fire',
        startTime,
        endTime: startTime + 3600000
      });
      
      // Award key to winner specifically (or broadcast if modal is local)
      fastify.io.emit('global:stadium_key_awarded', { 
        userId: winnerId,
        username: 'Vanguard_Warrior_1609',
        title: 'Stadium Founder'
      });

      return reply.send({ success: true, message: 'Ritual events emitted' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to emit ritual events' } });
    }
  });

};

export default statusRoutes;