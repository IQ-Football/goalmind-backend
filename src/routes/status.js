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

  // POST /status/decay — Trigger decay job (admin only)
  fastify.post('/decay', { preHandler: authenticate }, async (request, reply) => {
    // Only admins can trigger manually
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }
    try {
      const result = await runDailyDecayJob(fastify);
      return reply.send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to run decay job' } });
    }
  });

};

export default statusRoutes;