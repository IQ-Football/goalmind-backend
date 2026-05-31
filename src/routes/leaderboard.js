import { authenticate } from '../middleware/auth.js';
import { getAfricanPowerTable, SUPER_TRIBE_SLUGS } from '../services/africanGiantsService.js';
import { getTournamentRankings } from '../services/tournamentLeaderboardService.js';

// African Giants "Super-Tribes" — mirrors AFRICAN_GIANTS_SPECS.md from Product Strategist
const AFRICAN_CLUB_SLUGS = SUPER_TRIBE_SLUGS;

// Map of Super-Tribe IDs for the waitlist portal (African Giants slugs)
// IDs are populated after DB seed; use null as placeholder
const SUPER_TRIBE_IDS = {
  'al-ahly': null,
  'zamalek': null,
  'raja-casablanca': null,
  'wydad-casablanca': null,
  'esperance-de-tunis': null,
  'simba-sc': null,
  'yanga-sc': null,
  'tp-mazembe': null,
  'kaizer-chiefs': null,
  'orlando-pirates': null,
  'mamelodi-sundowns': null,
  'asante-kotoko': null,
};

const leaderboardRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /leaderboard/global - Global top 100 users
  fastify.get('/global', async (request, reply) => {
    const { limit = 100 } = request.query;
    const userId = request.user.id;
    const cacheKey = `cache:leaderboard:global:${limit}`;

    try {
      let leaderboard;
      let updatedAt;

      // Try cache
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        leaderboard = parsed.leaderboard;
        updatedAt = parsed.updatedAt;
      } else {
        // Get top users from Redis
        const topUsers = await fastify.redis.zrevrange(
          'leaderboard:global',
          0,
          Math.min(limit - 1, 99),
          'WITHSCORES'
        );

        // Parse Redis response (returns [userId, score, userId, score, ...])
        const uids = [];
        const scores = new Map();
        for (let i = 0; i < topUsers.length; i += 2) {
          uids.push(topUsers[i]);
          scores.set(topUsers[i], parseInt(topUsers[i + 1]));
        }

        leaderboard = [];
        if (uids.length > 0) {
          // Get user details from PostgreSQL in one query
          const usersResult = await fastify.db.query(
            `SELECT u.id, u.username, u.elo, t.name as tribe_name, t.slug as tribe_slug
             FROM users u
             LEFT JOIN tribes t ON u.tribe_id = t.id
             WHERE u.id = ANY($1)`,
            [uids]
          );

          // Map back to maintain Redis order
          const userMap = new Map(usersResult.rows.map(u => [u.id, u]));
          
          for (const uid of uids) {
            const user = userMap.get(uid);
            if (user) {
              leaderboard.push({
                rank: leaderboard.length + 1,
                userId: uid,
                username: user.username,
                elo: scores.get(uid) || user.elo,
                tribe: user.tribe_name,
                tribeSlug: user.tribe_slug,
              });
            }
          }
        }
        updatedAt = new Date().toISOString();
        // Cache for 30 seconds
        await fastify.redis.set(cacheKey, JSON.stringify({ leaderboard, updatedAt }), 'EX', 30);
      }

      // Get current user's rank (always fresh)
      const userRank = await fastify.redis.zrevrank('leaderboard:global', userId);
      const userElo = await fastify.redis.zscore('leaderboard:global', userId);

      // Calculate total users for percentile
      const totalUsers = await fastify.redis.zcard('leaderboard:global');

      return reply.send({
        success: true,
        data: {
          leaderboard,
          userRank: {
            rank: userRank !== null ? userRank + 1 : null,
            elo: parseInt(userElo) || 1000,
            percentile: userRank !== null ? ((totalUsers - userRank - 1) / totalUsers * 100).toFixed(1) : null,
          },
          updatedAt,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch global leaderboard',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leaderboard/tribal - Tribe power rankings
  fastify.get('/tribal', async (request, reply) => {
    const { limit = 100 } = request.query;

    try {
      // Get top tribes from Redis
      const topTribes = await fastify.redis.zrevrange(
        'leaderboard:tribal',
        0,
        Math.min(limit - 1, 99),
        'WITHSCORES'
      );

      // Parse Redis response
      const leaderboard = [];
      for (let i = 0; i < topTribes.length; i += 2) {
        const tribeId = topTribes[i];
        const points = parseInt(topTribes[i + 1]);

        // Get tribe details from PostgreSQL
        const tribeResult = await fastify.db.query(
          `SELECT id, name, type, slug, logo_url, primary_color, secondary_color, member_count
           FROM tribes WHERE id = $1`,
          [tribeId]
        );

        if (tribeResult.rows.length > 0) {
          const tribe = tribeResult.rows[0];
          leaderboard.push({
            rank: leaderboard.length + 1,
            tribeId,
            name: tribe.name,
            type: tribe.type,
            slug: tribe.slug,
            logoUrl: tribe.logo_url,
            colors: {
              primary: tribe.primary_color,
              secondary: tribe.secondary_color,
            },
            points: points || 0,
            memberCount: tribe.member_count,
          });
        }
      }

      return reply.send({
        success: true,
        data: {
          leaderboard,
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tribal leaderboard',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leaderboard/african-giants - African Power Table: 12 Super-Tribes ranked by
  // Tribe_Score = (Waitlist_Signups × 1.0) + (Avg_Fan_IQ × 0.5) + (Daily_Engagement × 0.3)
  fastify.get('/african-giants', async (request, reply) => {
    const { limit = 12 } = request.query;
    const cacheKey = `cache:leaderboard:african-giants:${limit}`;

    try {
      let leaderboard;
      const cached = await fastify.redis.get(cacheKey);
      
      if (cached) {
        leaderboard = JSON.parse(cached);
      } else {
        leaderboard = await getAfricanPowerTable(fastify, Math.min(parseInt(limit), 12));
        // Cache for 60 seconds (African Giants moves slower than global)
        await fastify.redis.set(cacheKey, JSON.stringify(leaderboard), 'EX', 60);
      }

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
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch African Giants leaderboard',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leaderboard/africa - Top users from African Giants clubs
  // Returns users ranked by ELO who support the 12 African Giants
  fastify.get('/africa', async (request, reply) => {
    const { limit = 100 } = request.query;
    const userId = request.user.id;

    try {
      // Get users in African Giants clubs, sorted by ELO
      const usersResult = await fastify.db.query(
        `SELECT u.id, u.username, u.elo, t.id as tribe_id, t.name as tribe_name, t.slug as tribe_slug,
                t.primary_color, t.secondary_color
         FROM users u
         JOIN tribes t ON u.tribe_id = t.id
         WHERE t.slug = ANY($1) AND u.elo IS NOT NULL
         ORDER BY u.elo DESC
         LIMIT $2`,
        [Array.from(AFRICAN_CLUB_SLUGS), limit]
      );

      const leaderboard = usersResult.rows.map((row, idx) => ({
        rank: idx + 1,
        userId: row.id,
        username: row.username,
        elo: row.elo,
        tribe: {
          id: row.tribe_id,
          name: row.tribe_name,
          slug: row.tribe_slug,
          colors: {
            primary: row.primary_color,
            secondary: row.secondary_color,
          },
        },
      }));

      // Get current user's rank if they belong to an African club
      let userRank = null;
      const userResult = await fastify.db.query(
        `SELECT u.elo, u.tribe_id, t.slug as tribe_slug
         FROM users u
         JOIN tribes t ON u.tribe_id = t.id
         WHERE u.id = $1`,
        [userId]
      );

      if (userResult.rows.length > 0 && AFRICAN_CLUB_SLUGS.has(userResult.rows[0].tribe_slug)) {
        const rankResult = await fastify.db.query(
          `SELECT COUNT(*) + 1 as rank
           FROM users u
           JOIN tribes t ON u.tribe_id = t.id
           WHERE t.slug = ANY($1) AND u.elo > $2`,
          [Array.from(AFRICAN_CLUB_SLUGS), userResult.rows[0].elo]
        );
        userRank = {
          rank: parseInt(rankResult.rows[0].rank),
          elo: userResult.rows[0].elo,
          tribe: userResult.rows[0].tribe_slug,
        };
      }

      return reply.send({
        success: true,
        data: {
          leaderboard,
          userRank,
          category: 'Continental: Africa',
          description: 'African Giants - Continental club fans compete for continental glory',
          totalClubs: AFRICAN_CLUB_SLUGS.size,
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch African leaderboard',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leaderboard/africa/tribal - African Giants Tribe Power Rankings (Power Table)
  // Uses the full scoring formula: Waitlist×1.0 + Avg_IQ×0.5 + Engagement×0.3
  fastify.get('/africa/tribal', async (request, reply) => {
    const { limit = 12 } = request.query;

    try {
      const leaderboard = await getAfricanPowerTable(fastify, Math.min(parseInt(limit), 12));

      return reply.send({
        success: true,
        data: {
          leaderboard,
          category: 'African Power Table',
          subcategory: 'Tribal',
          description: 'African Giants Club Power Rankings — African Power Table',
          scoringFormula: {
            description: 'Tribe_Score = (Waitlist × 1.0) + (Avg_Fan_IQ × 0.5) + (Daily_Engagement × 0.3)',
            weights: { waitlist: 1.0, avgIq: 0.5, engagement: 0.3 },
          },
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch African tribal leaderboard',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leaderboard/super-tribes - Get Super-Tribe IDs for the waitlist portal
  // Returns the 12 African Giants with their IDs for mapping in the waitlist system
  fastify.get('/super-tribes', async (request, reply) => {
    try {
      const result = await fastify.db.query(
        `SELECT id, name, slug, logo_url, primary_color, secondary_color, member_count, total_points
         FROM tribes
         WHERE slug = ANY($1)
         ORDER BY total_points DESC NULLS LAST
         LIMIT 20`,
        [Array.from(AFRICAN_CLUB_SLUGS)]
      );

      const superTribes = result.rows.map((tribe, idx) => ({
        rank: idx + 1,
        tribeId: tribe.id,
        name: tribe.name,
        slug: tribe.slug,
        logoUrl: tribe.logo_url,
        colors: {
          primary: tribe.primary_color,
          secondary: tribe.secondary_color,
        },
        memberCount: tribe.member_count || 0,
        points: tribe.total_points || 0,
        isSuperTribe: true,
      }));

      return reply.send({
        success: true,
        data: {
          superTribes,
          category: 'Continental: Africa',
          classification: 'Super-Tribe',
          totalSuperTribes: result.rows.length,
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch super-tribes',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leaderboard/tournament - 5v5 Tribe Relay Tournament Rankings
  fastify.get('/tournament', async (request, reply) => {
    try {
      const rankings = await getTournamentRankings(fastify);

      return reply.send({
        success: true,
        data: {
          rankings,
          updatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tournament rankings',
          requestId: request.id,
        },
      });
    }
  });
};

export default leaderboardRoutes;
