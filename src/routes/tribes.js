import { authenticate } from '../middleware/auth.js';
import { getTribeIdentity, updateTribeIdentity } from '../services/tribeIdentityService.js';
import { getWarRoomData } from '../services/tribeWarRoomService.js';

const tribeRoutes = async (fastify, options) => {
  // GET /tribes/config - Unified tribe configuration for frontends
  fastify.get('/config', async (request, reply) => {
    const cacheKey = 'cache:tribes:config';
    try {
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      const result = await fastify.db.query(`
        SELECT id, name, slug, type, logo_url, primary_color, secondary_color, 
               region, is_super_tribe, motto, banner_url
        FROM tribes
        ORDER BY is_super_tribe DESC, name ASC
      `);

      const response = {
        success: true,
        data: {
          tribes: result.rows,
          superTribes: result.rows.filter(t => t.is_super_tribe),
          categories: ['club', 'national', 'university'],
          regions: [...new Set(result.rows.map(t => t.region))],
          lastUpdated: new Date().toISOString()
        }
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 300);
      return reply.send(response);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tribe configuration' }
      });
    }
  });

  // GET /tribes - List all tribes
  fastify.get('/', async (request, reply) => {
    const { type, sort = 'member_count' } = request.query;
    const cacheKey = `cache:tribes:list:${type || 'all'}:${sort}`;

    try {
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      let query = `
        SELECT t.id, t.name, t.type, t.slug, t.logo_url, 
               t.primary_color, t.secondary_color, t.total_points, t.member_count,
               t.created_at, t.banner_url, t.motto
        FROM tribes t
      `;
      const params = [];

      if (type) {
        query += ' WHERE t.type = $1';
        params.push(type);
      }

      if (sort === 'points') {
        query += ' ORDER BY t.total_points DESC';
      } else if (sort === 'name') {
        query += ' ORDER BY t.name ASC';
      } else {
        query += ' ORDER BY t.member_count DESC';
      }

      const result = await fastify.db.query(query, params);

      const response = {
        success: true,
        data: {
          tribes: result.rows,
          total: result.rows.length,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 60);
      return reply.send(response);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tribes',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribes/:slug/war-room - Fetch data for the Tribal War Room
  fastify.get('/:slug/war-room', async (request, reply) => {
    const { slug } = request.params;

    try {
      const data = await getWarRoomData(fastify, slug);

      return reply.send({
        success: true,
        data,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      if (err.message === 'TRIBE_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TRIBE_NOT_FOUND',
            message: 'Tribe not found',
            requestId: request.id,
          },
        });
      }

      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch War Room data',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribes/:tribeId/identity - Fetch tribal visual configuration
  fastify.get('/:id/identity', async (request, reply) => {
    const { id } = request.params;

    try {
      const identity = await getTribeIdentity(fastify, id);

      if (!identity) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TRIBE_NOT_FOUND',
            message: 'Tribe not found',
            requestId: request.id,
          },
        });
      }

      return reply.send({
        success: true,
        data: identity,
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
          message: 'Failed to fetch tribe identity',
          requestId: request.id,
        },
      });
    }
  });

  // PATCH /tribes/:tribeId/identity - Update tribal assets
  fastify.patch('/:id/identity', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { motto, primaryColor, secondaryColor, bannerUrl } = request.body;
    const userId = request.user.id;

    try {
      const result = await updateTribeIdentity(fastify, {
        tribeId: id,
        userId,
        motto,
        primaryColor,
        secondaryColor,
        bannerUrl,
      });

      return reply.send({
        success: true,
        data: result.data,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      
      if (err.message.includes('Unauthorized')) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: err.message,
            requestId: request.id,
          },
        });
      }

      if (err.message.includes('User not found')) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: err.message,
            requestId: request.id,
          },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update tribe identity',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribes/:slug/stats - Tribe comprehensive statistics
  fastify.get('/:slug/stats', async (request, reply) => {
    const { slug } = request.params;
    const cacheKey = `cache:tribes:stats:${slug}`;

    try {
      // 1. Try cache
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      // 2. Fetch tribe basic info
      const tribeResult = await fastify.db.query(
        'SELECT id, name, slug, member_count, avg_fan_iq, region, is_super_tribe FROM tribes WHERE slug = $1',
        [slug]
      );

      if (tribeResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TRIBE_NOT_FOUND',
            message: 'Tribe not found',
            requestId: request.id,
          },
        });
      }

      const tribe = tribeResult.rows[0];

      // 2. Calculate aggregate IQ and top 10 IQ earners
      const usersResult = await fastify.db.query(
        `SELECT id, username, elo 
         FROM users 
         WHERE tribe_id = $1 AND elo IS NOT NULL
         ORDER BY elo DESC`,
        [tribe.id]
      );

      const topMembers = usersResult.rows.slice(0, 10);
      const totalEloSum = usersResult.rows.reduce((sum, user) => sum + (parseInt(user.elo) || 0), 0);
      
      // Use the higher of member_count or actual users found
      const totalSignups = Math.max(parseInt(tribe.member_count) || 0, usersResult.rows.length);

      // 3. Calculate continental rank based on aggregate IQ
      // Map region to continent grouping
      const regionToContinent = {
        'Nigeria': 'Africa',
        'West Africa': 'Africa',
        'North Africa': 'Africa',
        'East Africa': 'Africa',
        'Central Africa': 'Africa',
        'Southern Africa': 'Africa',
        'Africa': 'Africa',
        'Europe': 'Europe',
        'Asia': 'Asia',
        'North America': 'North America',
        'South America': 'South America',
        'Other': 'Other'
      };

      const targetContinent = regionToContinent[tribe.region] || 'Other';
      const africanRegions = ['Nigeria', 'West Africa', 'North Africa', 'East Africa', 'Central Africa', 'Southern Africa', 'Africa'];
      
      const relevantRegions = targetContinent === 'Africa' ? africanRegions : [tribe.region];

      const rankResult = await fastify.db.query(
        `SELECT t.id, SUM(COALESCE(u.elo, 0)) as aggregate_iq
         FROM tribes t
         LEFT JOIN users u ON t.id = u.tribe_id
         WHERE t.region = ANY($1)
         GROUP BY t.id
         ORDER BY aggregate_iq DESC`,
        [relevantRegions]
      );

      const continentalRank = rankResult.rows.findIndex(r => r.id === tribe.id) + 1;

      const response = {
        success: true,
        data: {
          tribe: {
            id: tribe.id,
            name: tribe.name,
            slug: tribe.slug,
            region: tribe.region,
            isSuperTribe: tribe.is_super_tribe,
          },
          stats: {
            totalSignups,
            aggregateIq: totalEloSum,
            avgIq: usersResult.rows.length > 0 ? parseFloat((totalEloSum / usersResult.rows.length).toFixed(2)) : 0,
            continentalRank: continentalRank > 0 ? continentalRank : null,
            continent: targetContinent
          },
          topMembers: topMembers.map(m => ({
            id: m.id,
            username: m.username,
            iq: m.elo
          })),
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 120);
      return reply.send(response);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tribe statistics',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribes/:id - Tribe details + members
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    const cacheKey = `cache:tribes:details:${id}`;

    try {
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      const tribeResult = await fastify.db.query(
        `SELECT t.*, 
                (SELECT COUNT(*) FROM users WHERE tribe_id = t.id AND last_active_at > NOW() - INTERVAL '7 days') as active_members_7d
         FROM tribes t WHERE t.id = $1`,
        [id]
      );

      if (tribeResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TRIBE_NOT_FOUND',
            message: 'Tribe not found',
            requestId: request.id,
          },
        });
      }

      const tribe = tribeResult.rows[0];

      // Get top members
      const membersResult = await fastify.db.query(
        `SELECT u.id, u.username, u.elo, u.battles_won, tm.tier, tm.contribution_points
         FROM users u
         JOIN tribe_members tm ON u.id = tm.user_id
         WHERE u.tribe_id = $1
         ORDER BY tm.contribution_points DESC
         LIMIT 50`,
        [id]
      );

      // Get tribe's global rank
      const tribeRank = await fastify.redis.zrevrank('leaderboard:tribal', id);

      const response = {
        success: true,
        data: {
          tribe,
          members: membersResult.rows,
          globalRank: tribeRank !== null ? tribeRank + 1 : null,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: request.id,
        },
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 60);
      return reply.send(response);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch tribe details',
          requestId: request.id,
        },
      });
    }
  });

  // GET /tribes/:id/leaderboard - Tribe member rankings
  fastify.get('/:id/leaderboard', async (request, reply) => {
    const { id } = request.params;
    const { limit = 50 } = request.query;

    try {
      // Verify tribe exists
      const tribeResult = await fastify.db.query(
        'SELECT id, name FROM tribes WHERE id = $1',
        [id]
      );

      if (tribeResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TRIBE_NOT_FOUND',
            message: 'Tribe not found',
            requestId: request.id,
          },
        });
      }

      const leaderboardResult = await fastify.db.query(
        `SELECT u.id, u.username, u.elo, u.battles_played, u.battles_won,
                tm.tier, tm.contribution_points,
                ROW_NUMBER() OVER (ORDER BY u.elo DESC) as rank
         FROM users u
         JOIN tribe_members tm ON u.id = tm.user_id
         WHERE u.tribe_id = $1
         ORDER BY u.elo DESC
         LIMIT $2`,
        [id, limit]
      );

      return reply.send({
        success: true,
        data: {
          tribe: tribeResult.rows[0],
          leaderboard: leaderboardResult.rows,
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
          message: 'Failed to fetch tribe leaderboard',
          requestId: request.id,
        },
      });
    }
  });
};

export default tribeRoutes;
