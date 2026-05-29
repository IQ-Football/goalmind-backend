/**
 * African Giants Routes
 * 
 * Endpoints for the African Power Table, Giant of the Day, and Rivalry Boosters.
 */
import { authenticate } from '../middleware/auth.js';
import {
  getAfricanPowerTable,
  getGiantOfTheDay,
  getGiantOfTheDayQuestions,
  getActiveDerbies,
  isAfricanRivalry,
  getRivalryInfo,
  calculateBattlePointsWithBooster,
  recordDailyEngagement,
  updateAvgFanIq,
  registerWaitlistSignup,
  getTribeAfricanGiantsStats,
  recordWaitlistSignup,
  SUPER_TRIBE_SLUGS,
  getTribalBonusMultiplier,
  getGiantOfTheDaySlug,
} from '../services/africanGiantsService.js';

const africanGiantsRoutes = async (fastify, options) => {

  // ─── PUBLIC ROUTES (no auth required) ────────────────────────────────────────

  // GET /african-giants/power-table — African Power Table leaderboard
  // No auth required so waitlist landing pages can display it
  fastify.get('/power-table', async (request, reply) => {
    const { limit = 12 } = request.query;

    try {
      const leaderboard = await getAfricanPowerTable(fastify, parseInt(limit));

      return reply.send({
        success: true,
        data: {
          leaderboard,
          category: 'African Power Table',
          classification: 'Continental: Africa',
          totalClubs: leaderboard.length,
          scoringFormula: {
            description: 'Tribe_Score = (Waitlist_Signups × 1.0) + (Avg_Fan_IQ × 0.5) + (Daily_Engagement × 0.3)',
            weights: { waitlist: 1.0, avgIq: 0.5, engagement: 0.3 },
          },
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch Power Table' } });
    }
  });

  // GET /african-giants/giant-of-the-day — Today's featured tribe
  fastify.get('/giant-of-the-day', async (request, reply) => {
    try {
      const giant = await getGiantOfTheDay(fastify);
      if (!giant) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No Giant of the Day available' } });
      }

      return reply.send({
        success: true,
        data: giant,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch Giant of the Day' } });
    }
  });

  // GET /african-giants/tribal-bonus/status — Tribal bonus status for any tribe slug
  fastify.get('/tribal-bonus/status', async (request, reply) => {
    const { tribe_slug } = request.query;
    if (!tribe_slug) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'tribe_slug query param required' } });
    }
    try {
      const bonus = await getTribalBonusMultiplier(fastify, tribe_slug);
      const giant = await getGiantOfTheDay(fastify);
      return reply.send({ success: true, data: {
        queryTribeSlug: tribe_slug,
        isTribalBonus: bonus.isTribalBonus,
        multiplier: bonus.multiplier,
        todayGiantSlug: bonus.giantSlug,
        todayGiantName: bonus.giantName,
        giantOfTheDay: giant,
      }});
    } catch (err) { fastify.log.error(err); return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: "Failed to check tribal bonus status" } }); }
  });

  // GET /african-giants/tribal-bonus/schedule — Full 12-tribe rotation schedule (next 12 days)
  fastify.get('/tribal-bonus/schedule', async (request, reply) => {
    try {
      const slugs = Array.from(SUPER_TRIBE_SLUGS);
      const today = new Date();
      const schedule = slugs.map((slug, i) => {
        const date = new Date(today); date.setDate(today.getDate() + i);
        return { tribeSlug: slug, date: date.toISOString().split('T')[0], dayLabel: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), isToday: i === 0 };
      });
      return reply.send({ success: true, data: { schedule, totalTribes: slugs.length, currentGiant: schedule[0].tribeSlug, currentGiantDate: schedule[0].date } });
    } catch (err) { fastify.log.error(err); return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: "Failed to fetch schedule" } }); }
  });

  // GET /african-giants/derbies — All configured rivalry matchups
  fastify.get('/derbies', async (request, reply) => {
    const derbies = getActiveDerbies();
    return reply.send({
      success: true,
      data: { derbies },
    });
  });

  // POST /african-giants/waitlist — Register a waitlist signup
  // No auth required for public waitlist landing page
  fastify.post('/waitlist', async (request, reply) => {
    const { email, tribe_slug, username } = request.body;

    if (!email || !tribe_slug) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'email and tribe_slug are required' } });
    }

    if (!SUPER_TRIBE_SLUGS.has(tribe_slug)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_TRIBE', message: ' tribe_slug must be one of the 12 Super-Tribes' } });
    }

    try {
      const result = await registerWaitlistSignup(fastify, { email, tribeSlug: tribe_slug, username });
      if (result.error) {
        return reply.status(400).send({ success: false, error: { code: result.error, message: result.message } });
      }
      return reply.status(201).send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to register waitlist signup' } });
    }
  });

  // GET /african-giants/super-tribes — List all 12 Super-Tribes
  fastify.get('/super-tribes', async (request, reply) => {
    try {
      const result = await fastify.db.query(
        `SELECT id, name, slug, primary_color, secondary_color, logo_url, region,
                waitlist_signups, avg_fan_iq, daily_engagement_points, member_count
         FROM tribes WHERE slug = ANY($1)
         ORDER BY (COALESCE(waitlist_signups,0)*1.0 + COALESCE(avg_fan_iq,0)::numeric*0.5 + COALESCE(daily_engagement_points,0)*0.3) DESC`,
        [Array.from(SUPER_TRIBE_SLUGS)]
      );

      const superTribes = result.rows.map((t, idx) => ({
        rank: idx + 1,
        tribeId: t.id,
        name: t.name,
        slug: t.slug,
        region: t.region,
        logoUrl: t.logo_url,
        colors: { primary: t.primary_color, secondary: t.secondary_color },
        waitlistSignups: parseInt(t.waitlist_signups) || 0,
        avgFanIq: parseFloat(t.avg_fan_iq) || 0,
        dailyEngagementPoints: parseInt(t.daily_engagement_points) || 0,
        memberCount: parseInt(t.member_count) || 0,
        isSuperTribe: true,
      }));

      return reply.send({ success: true, data: { superTribes, totalSuperTribes: superTribes.length } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch Super-Tribes' } });
    }
  });

  // ─── AUTHENTICATED ROUTES ────────────────────────────────────────────────────

  // GET /african-giants/giant-of-the-day/questions — Questions for today's featured tribe
  fastify.get('/giant-of-the-day/questions', { preHandler: authenticate }, async (request, reply) => {
    try {
      const giant = await getGiantOfTheDay(fastify);
      if (!giant) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No Giant of the Day' } });
      }

      const questions = await getGiantOfTheDayQuestions(fastify, giant.tribeId, 10);
      return reply.send({ success: true, data: { giant, questions } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch questions' } });
    }
  });

  // POST /african-giants/engage — Record a daily engagement event
  fastify.post('/engage', { preHandler: authenticate }, async (request, reply) => {
    const { engagement_type = 'daily_login' } = request.body;
    const userId = request.user.id;

    try {
      // Get user's tribe
      const userResult = await fastify.db.query(
        'SELECT tribe_id FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0 || !userResult.rows[0].tribe_id) {
        return reply.status(400).send({ success: false, error: { code: 'NO_TRIBE', message: 'User has no tribe assigned' } });
      }
      const tribeId = userResult.rows[0].tribe_id;

      const result = await recordDailyEngagement(fastify, userId, tribeId, engagement_type);
      if (!result) {
        return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to record engagement' } });
      }

      return reply.send({ success: true, data: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to record engagement' } });
    }
  });

  // GET /african-giants/my-tribe/stats — Current user's tribe stats in African Giants
  fastify.get('/my-tribe/stats', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;

    try {
      const userResult = await fastify.db.query(
        'SELECT tribe_id FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0 || !userResult.rows[0].tribe_id) {
        return reply.status(400).send({ success: false, error: { code: 'NO_TRIBE', message: 'User has no tribe' } });
      }

      const stats = await getTribeAfricanGiantsStats(fastify, userResult.rows[0].tribe_id);
      if (!stats) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tribe not found' } });
      }

      return reply.send({ success: true, data: stats });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' } });
    }
  });

  // GET /african-giants/rivalry/:slug1/:slug2 — Check rivalry + multiplier info between two tribes
  fastify.get('/rivalry/:slug1/:slug2', { preHandler: authenticate }, async (request, reply) => {
    const { slug1, slug2 } = request.params;

    const isRivalry = isAfricanRivalry(slug1, slug2);
    const rivalryInfo = isRivalry ? getRivalryInfo(slug1, slug2) : null;

    return reply.send({
      success: true,
      data: {
        slug1,
        slug2,
        isRivalry,
        rivalryName: rivalryInfo?.name || null,
        multiplier: isRivalry ? 2 : 1,
        description: isRivalry
          ? `⚽ ${rivalryInfo.name}: 2× Power Table points for battles today!`
          : 'No rivalry configured for this matchup.',
      },
    });
  });

  // POST /african-giants/rivalry/:slug1/:slug2/simulate — Simulate tribal + rivalry booster on a mock battle result
  fastify.post('/rivalry/:slug1/:slug2/simulate', { preHandler: authenticate }, async (request, reply) => {
    const { slug1, slug2 } = request.params;
    const { base_points = 10 } = request.body;

    const result = await calculateBattlePointsWithBooster(fastify, base_points, slug1, slug2);

    return reply.send({
      success: true,
      data: {
        slug1,
        slug2,
        basePoints: result.basePoints,
        boostedPoints: result.boostedPoints,
        totalMultiplier: result.totalMultiplier,
        isTribalBonus: result.isTribalBonus,
        tribalGiant: result.tribalGiant,
        isDerby: result.isDerby,
        derbyName: result.derbyName,
        breakdown: result.breakdown,
        message: result.isTribalBonus
          ? `🏆 Tribal Bonus + ${result.tribalGiant}! Points: ${result.boostedPoints} (base ×${result.totalMultiplier})`
          : result.isDerby
          ? `🔥 Derby Battle! ${result.derbyName}: ${result.boostedPoints} points (×${result.totalMultiplier})`
          : `Normal battle: ${result.boostedPoints} points to ${slug1}`,
      },
    });
  });

  // GET /african-giants/rank — Current user's tribe's rank on the Power Table
  fastify.get('/rank', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.id;

    try {
      const userResult = await fastify.db.query(
        'SELECT tribe_id FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0 || !userResult.rows[0].tribe_id) {
        return reply.status(400).send({ success: false, error: { code: 'NO_TRIBE', message: 'User has no tribe' } });
      }
      const tribeId = userResult.rows[0].tribe_id;

      const leaderboard = await getAfricanPowerTable(fastify, 12);
      const myEntry = leaderboard.find(e => e.tribeId === tribeId);

      if (!myEntry) {
        return reply.send({ success: true, data: { rank: null, message: 'Your tribe is not yet ranked in the African Power Table' } });
      }

      return reply.send({ success: true, data: { rank: myEntry.rank, tribe: myEntry } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rank' } });
    }
  });

  // POST /african-giants/admin/signup-boost — Admin: boost waitlist signups for a tribe
  fastify.post('/admin/signup-boost', { preHandler: authenticate }, async (request, reply) => {
    const { tribe_id, amount = 1 } = request.body;
    const userId = request.user.id;

    // Check admin role
    const adminResult = await fastify.db.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );
    if (!adminResult.rows.length || adminResult.rows[0].role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }

    if (!tribe_id || !amount) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'tribe_id and amount required' } });
    }

    try {
      await fastify.db.query(
        'UPDATE tribes SET waitlist_signups = waitlist_signups + $1 WHERE id = $2',
        [amount, tribe_id]
      );
      return reply.send({ success: true, data: { tribe_id, addedSignups: amount } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to boost signups' } });
    }
  });

  // POST /african-giants/admin/update-iq — Admin: recalculate avg Fan IQ for a tribe
  fastify.post('/admin/update-iq', { preHandler: authenticate }, async (request, reply) => {
    const { tribe_id } = request.body;
    const userId = request.user.id;

    const adminResult = await fastify.db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!adminResult.rows.length || adminResult.rows[0].role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }

    if (!tribe_id) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'tribe_id required' } });
    }

    try {
      await updateAvgFanIq(fastify, tribe_id);
      const tribeResult = await fastify.db.query('SELECT avg_fan_iq FROM tribes WHERE id = $1', [tribe_id]);
      return reply.send({ success: true, data: { tribe_id, avgFanIq: parseFloat(tribeResult.rows[0]?.avg_fan_iq) || 0 } });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update IQ' } });
    }
  });
};

export default africanGiantsRoutes;
