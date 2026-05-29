import { authenticate } from '../middleware/auth.js';
import {
  generateReferralCode,
  buildReferralLink,
  parseReferralCode,
  recordReferralAttribution,
  checkAndAwardMilestoneRewards,
  getTopRecruiters,
  getUserReferralStats,
  generateShareCardData,
} from '../services/referralService.js';

const referralRoutes = async (fastify, options) => {
  
  // GET /referrals/link — Generate user's unique referral link
  fastify.get('/link', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    const tribeId = request.user.tribe_id;
    
    if (!tribeId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_TRIBE', message: 'Select a National Tribe first to generate referral link' },
      });
    }
    
    // Check if user already has a referral code
    let referralCode = request.user.referral_code;
    if (!referralCode) {
      referralCode = generateReferralCode(userId, tribeId);
      // Save to user record
      await fastify.db.query(
        `UPDATE users SET referral_code = $1 WHERE id = $2`,
        [referralCode, userId]
      );
    }
    
    const links = buildReferralLink(referralCode, tribeId);
    
    return reply.send({
      success: true,
      data: {
        referralCode,
        deepLink: links.deepLink,
        webLink: links.webLink,
        shareText: `Join my tribe on GoalMind! Use my referral: ${links.webLink}`,
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
  
  // POST /referrals/attribute — Record a new referral attribution (called when new user joins)
  fastify.post('/attribute', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const recruitId = request.user.id;
    const { referralCode, tribeId, source } = request.body;
    
    if (!referralCode) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_CODE', message: 'referralCode is required' },
      });
    }
    
    // Find referrer by referral code
    const referrerResult = await fastify.db.query(
      `SELECT id, tribe_id FROM users WHERE referral_code = $1`,
      [referralCode]
    );
    
    if (referrerResult.rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Invalid referral code' },
      });
    }
    
    const referrer = referrerResult.rows[0];
    
    // Can't refer yourself
    if (referrer.id === recruitId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'SELF_REFERRAL', message: 'Cannot refer yourself' },
      });
    }
    
    // Update recruit's referred_by
    await fastify.db.query(
      `UPDATE users SET referred_by = $1 WHERE id = $2`,
      [referrer.id, recruitId]
    );
    
    // Record attribution
    const result = await recordReferralAttribution(fastify, {
      referrerId: referrer.id,
      recruitId,
      referralCode,
      tribeId: tribeId || referrer.tribe_id,
      source: source || 'direct',
    });
    
    return reply.send({
      success: true,
      data: {
        referralId: result.referralId,
        referrerId: referrer.id,
        milestone: 'joined',
        reward: { type: 'nation_points', amount: 500, label: '+500 Nation Points' },
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
  
  // GET /referrals/stats — Get user's referral stats
  fastify.get('/stats', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    const stats = await getUserReferralStats(fastify, userId);
    
    return reply.send({
      success: true,
      data: stats,
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
  
  // GET /referrals/leaderboard — Top recruiters (global or per nation)
  fastify.get('/leaderboard', async (request, reply) => {
    const { limit = 10, tribe_id } = request.query;
    
    const leaders = await getTopRecruiters(fastify, { limit: parseInt(limit), tribeId: tribe_id });
    
    return reply.send({
      success: true,
      data: {
        leaders,
        category: tribe_id ? 'national' : 'global',
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
  
  // GET /referrals/share-card — Generate share card data for a user
  fastify.get('/share-card', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    
    // Get user with tribe info
    const userResult = await fastify.db.query(
      `SELECT u.*, t.name as tribe_name, t.slug as tribe_slug, t.primary_color, t.secondary_color
       FROM users u
       JOIN tribes t ON t.id = u.tribe_id
       WHERE u.id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'USER_NOT_FOUND' } });
    }
    
    const user = userResult.rows[0];
    
    // Get user's nation ranking
    const rankResult = await fastify.db.query(
      `SELECT rank FROM national_leaderboard WHERE tribe_id = $1`,
      [user.tribe_id]
    );
    
    const cardData = generateShareCardData(
      { id: user.id, username: user.username },
      { name: user.tribe_name, slug: user.tribe_slug },
      {
        referralCount: user.referral_count,
        battlesCount: user.battle_count,
        nationRank: rankResult.rows[0]?.rank || '#--',
        webLink: `${process.env.APP_URL || 'https://goalmind.app'}/join?ref=${user.referral_code}`,
        referralCode: user.referral_code,
      }
    );
    
    return reply.send({
      success: true,
      data: cardData,
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
  
  // POST /referrals/milestone — Trigger milestone check (called after battle/league events)
  fastify.post('/milestone', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;
    const { milestone, recruitId } = request.body;
    
    if (!milestone) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_MILESTONE', message: 'milestone is required' },
      });
    }
    
    const rewards = await checkAndAwardMilestoneRewards(fastify, userId, milestone, recruitId);
    
    return reply.send({
      success: true,
      data: {
        milestone,
        rewardsAwarded: rewards.length,
        rewards,
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
  
  // GET /referrals/national-table — The Global National IQ Table (48 nations)
  fastify.get('/national-table', async (request, reply) => {
    const result = await fastify.db.query(
      `SELECT * FROM national_leaderboard ORDER BY rank LIMIT 48`
    );
    
    return reply.send({
      success: true,
      data: {
        nations: result.rows.map(r => ({
          rank: parseInt(r.rank),
          tribeId: r.tribe_id,
          tribeName: r.tribe_name,
          tribeSlug: r.tribe_slug,
          region: r.region,
          totalUsers: parseInt(r.total_users),
          totalNationPoints: parseInt(r.total_nation_points),
          avgBattles: parseFloat(r.avg_battles).toFixed(1),
        })),
      },
      meta: { timestamp: new Date().toISOString(), requestId: request.id },
    });
  });
};

export default referralRoutes;