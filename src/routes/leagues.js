import { authenticate } from '../middleware/auth.js';

const leagueRoutes = async (fastify, options) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /leagues - List all leagues
  fastify.get('/', async (request, reply) => {
    const { active } = request.query;

    try {
      let query = 'SELECT * FROM leagues';
      const params = [];

      if (active !== undefined) {
        query += ' WHERE is_active = $1';
        params.push(active === 'true');
      }

      query += ' ORDER BY tier ASC';

      const result = await fastify.db.query(query, params);

      return reply.send({
        success: true,
        data: {
          leagues: result.rows,
          total: result.rows.length,
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
          message: 'Failed to fetch leagues',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leagues/me - Get current user's league status
  fastify.get('/me', async (request, reply) => {
    const userId = request.user.id;

    try {
      // Get user's current active league participation
      const participantResult = await fastify.db.query(
        `SELECT lp.*, l.name as league_name, l.tier, l.slug as league_slug
         FROM league_participants lp
         JOIN leagues l ON lp.league_id = l.id
         WHERE lp.user_id = $1 AND l.is_active = true
         ORDER BY lp.joined_at DESC
         LIMIT 1`,
        [userId]
      );

      if (participantResult.rows.length === 0) {
        return reply.send({
          success: true,
          data: {
            inLeague: false,
            currentLeague: null,
            rank: null,
            message: 'Not currently in a league. Join a new season to start!',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: request.id,
          },
        });
      }

      const participant = participantResult.rows[0];

      // Get total participants in this league for percentile calculation
      const countResult = await fastify.db.query(
        'SELECT COUNT(*) FROM league_participants WHERE league_id = $1',
        [participant.league_id]
      );
      const totalParticipants = parseInt(countResult.rows[0].count);

      return reply.send({
        success: true,
        data: {
          inLeague: true,
          currentLeague: {
            id: participant.league_id,
            name: participant.league_name,
            tier: participant.tier,
            slug: participant.league_slug,
          },
          rank: participant.rank,
          totalParticipants,
          percentile: participant.rank ? ((totalParticipants - participant.rank) / totalParticipants * 100).toFixed(1) : null,
          elo: participant.current_elo,
          battlesPlayed: participant.battles_played,
          battlesWon: participant.battles_won,
          isPromoted: participant.is_promoted,
          isRelegated: participant.is_relegated,
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
          message: 'Failed to fetch user league status',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leagues/:id - Get league details
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const leagueResult = await fastify.db.query(
        'SELECT * FROM leagues WHERE id = $1',
        [id]
      );

      if (leagueResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'LEAGUE_NOT_FOUND',
            message: 'League not found',
            requestId: request.id,
          },
        });
      }

      const league = leagueResult.rows[0];

      // Get participant count
      const countResult = await fastify.db.query(
        'SELECT COUNT(*) FROM league_participants WHERE league_id = $1',
        [id]
      );

      return reply.send({
        success: true,
        data: {
          league: {
            ...league,
            participantCount: parseInt(countResult.rows[0].count),
          },
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
          message: 'Failed to fetch league details',
          requestId: request.id,
        },
      });
    }
  });

  // GET /leagues/:id/standings - Get league standings
  fastify.get('/:id/standings', async (request, reply) => {
    const { id } = request.params;
    const { limit = 50, offset = 0 } = request.query;
    const userId = request.user.id;

    try {
      // Verify league exists
      const leagueResult = await fastify.db.query(
        'SELECT * FROM leagues WHERE id = $1',
        [id]
      );

      if (leagueResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'LEAGUE_NOT_FOUND',
            message: 'League not found',
            requestId: request.id,
          },
        });
      }

      // Get standings
      const standingsResult = await fastify.db.query(
        `SELECT lp.rank, lp.current_elo, lp.battles_played, lp.battles_won,
                u.id as user_id, u.username,
                t.name as tribe_name, t.slug as tribe_slug
         FROM league_participants lp
         JOIN users u ON lp.user_id = u.id
         LEFT JOIN tribes t ON u.tribe_id = t.id
         WHERE lp.league_id = $1
         ORDER BY lp.rank ASC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      // Get user's rank in this league
      const userRankResult = await fastify.db.query(
        'SELECT rank FROM league_participants WHERE league_id = $1 AND user_id = $2',
        [id, userId]
      );

      return reply.send({
        success: true,
        data: {
          league: leagueResult.rows[0],
          standings: standingsResult.rows,
          userRank: userRankResult.rows.length > 0 ? userRankResult.rows[0].rank : null,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
          },
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
          message: 'Failed to fetch league standings',
          requestId: request.id,
        },
      });
    }
  });

  // POST /leagues/join - Join a league for new season
  fastify.post('/join', async (request, reply) => {
    const userId = request.user.id;
    const { leagueId } = request.body;

    try {
      // Get user's current Elo
      const userResult = await fastify.db.query(
        'SELECT elo, battles_played, battles_won FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId: request.id,
          },
        });
      }

      const user = userResult.rows[0];

      // If leagueId not specified, find appropriate league based on Elo
      let targetLeagueId = leagueId;
      
      if (!targetLeagueId) {
        const leagueResult = await fastify.db.query(
          `SELECT id FROM leagues 
           WHERE is_active = true 
             AND min_elo <= $1 AND max_elo > $1
           ORDER BY tier ASC
           LIMIT 1`,
          [user.elo]
        );

        if (leagueResult.rows.length === 0) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'NO_LEAGUE_AVAILABLE',
              message: 'No active league available for your Elo rating',
              requestId: request.id,
            },
          });
        }
        targetLeagueId = leagueResult.rows[0].id;
      }

      // Check if already in this league
      const existingResult = await fastify.db.query(
        'SELECT id FROM league_participants WHERE league_id = $1 AND user_id = $2',
        [targetLeagueId, userId]
      );

      if (existingResult.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'ALREADY_IN_LEAGUE',
            message: 'You are already participating in this league',
            requestId: request.id,
          },
        });
      }

      // Get current participant count to determine rank
      const countResult = await fastify.db.query(
        'SELECT COUNT(*) FROM league_participants WHERE league_id = $1',
        [targetLeagueId]
      );
      const currentCount = parseInt(countResult.rows[0].count);

      // Add to league
      const participantResult = await fastify.db.query(
        `INSERT INTO league_participants 
         (user_id, league_id, elo_at_season_start, current_elo, battles_played, battles_won, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          targetLeagueId,
          user.elo,
          user.elo,
          user.battles_played,
          user.battles_won,
          currentCount + 1
        ]
      );

      // Get league info
      const leagueInfoResult = await fastify.db.query(
        'SELECT name, tier, slug FROM leagues WHERE id = $1',
        [targetLeagueId]
      );

      return reply.status(201).send({
        success: true,
        data: {
          participant: participantResult.rows[0],
          league: leagueInfoResult.rows[0],
          message: 'Successfully joined the league!',
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
          message: 'Failed to join league',
          requestId: request.id,
        },
      });
    }
  });

  // POST /leagues/season-end - Process season end (promotion/relegation)
  fastify.post('/season-end', async (request, reply) => {
    const { leagueId } = request.body;

    try {
      // Get the league
      const leagueResult = await fastify.db.query(
        'SELECT * FROM leagues WHERE id = $1',
        [leagueId]
      );

      if (leagueResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'LEAGUE_NOT_FOUND',
            message: 'League not found',
            requestId: request.id,
          },
        });
      }

      const league = leagueResult.rows[0];
      const participantsResult = await fastify.db.query(
        `SELECT * FROM league_participants 
         WHERE league_id = $1 
         ORDER BY current_elo DESC`,
        [leagueId]
      );

      const participants = participantsResult.rows;
      const totalCount = participants.length;
      
      if (totalCount === 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'NO_PARTICIPANTS',
            message: 'No participants in this league',
            requestId: request.id,
          },
        });
      }

      // Calculate promotion/relegation thresholds
      const promotionCount = Math.ceil(totalCount * (league.promotion_threshold_percent / 100));
      const relegationCount = Math.ceil(totalCount * (league.relegation_threshold_percent / 100));
      const promotionBoundary = promotionCount; // Top N
      const relegationBoundary = totalCount - relegationCount; // Bottom N

      // Get next higher and lower leagues
      const nextLeagueResult = await fastify.db.query(
        'SELECT id FROM leagues WHERE tier = $1 AND is_active = true LIMIT 1',
        [league.tier + 1]
      );
      const prevLeagueResult = await fastify.db.query(
        'SELECT id FROM leagues WHERE tier = $1 AND is_active = true LIMIT 1',
        [league.tier - 1]
      );

      const nextLeagueId = nextLeagueResult.rows[0]?.id;
      const prevLeagueId = prevLeagueResult.rows[0]?.id;

      let promotedCount = 0;
      let relegatedCount = 0;
      const processedUserIds = [];

      // Process each participant
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const newRank = i + 1;
        let isPromoted = false;
        let isRelegated = false;

        // Update rank
        await fastify.db.query(
          `UPDATE league_participants 
           SET rank = $1, last_updated_at = NOW()
           WHERE id = $2`,
          [newRank, p.id]
        );

        // Check promotion (top 10%)
        if (i < promotionBoundary && nextLeagueId) {
          await fastify.db.query(
            `UPDATE league_participants SET is_promoted = true WHERE id = $1`,
            [p.id]
          );
          promotedCount++;
          isPromoted = true;
        }

        // Check relegation (bottom 20%)
        if (i >= relegationBoundary && prevLeagueId) {
          await fastify.db.query(
            `UPDATE league_participants SET is_relegated = true WHERE id = $1`,
            [p.id]
          );
          relegatedCount++;
          isRelegated = true;
        }

        processedUserIds.push({
          userId: p.user_id,
          newRank,
          isPromoted,
          isRelegated,
          nextLeague: isPromoted ? nextLeagueId : (isRelegated ? prevLeagueId : null),
        });
      }

      return reply.send({
        success: true,
        data: {
          league: {
            id: league.id,
            name: league.name,
            tier: league.tier,
          },
          summary: {
            totalParticipants: totalCount,
            promotedCount,
            relegatedCount,
            keptSameRank: totalCount - promotedCount - relegatedCount,
          },
          processedParticipants: processedUserIds,
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
          message: 'Failed to process season end',
          requestId: request.id,
        },
      });
    }
  });
};

export default leagueRoutes;
