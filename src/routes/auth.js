import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import otpService from '../services/otpService.js';
import referralService from '../services/referralService.js';
import guestService from '../services/guestService.js';
import { processTribalCatchup } from '../services/tribeIdentityService.js';
import { trigger25kMilestone, trigger50kMilestone } from '../services/milestoneService.js';

const authRoutes = async (fastify, options) => {
  // POST /auth/register - Create account with tribe selection
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'email', 'password', 'tribeId'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 50 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          tribeId: { type: 'string', format: 'uuid' },
          referralCode: { type: 'string' },
          trialTokens: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { username, email, password, tribeId, referralCode, trialTokens } = request.body;

    try {
      // Check if user exists
      const existingUser = await fastify.db.query(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );

      if (existingUser.rows.length > 0) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'USER_EXISTS',
            message: 'Username or email already exists',
            requestId: request.id,
          },
        });
      }

      // Verify tribe exists
      const tribeResult = await fastify.db.query(
        'SELECT id FROM tribes WHERE id = $1',
        [tribeId]
      );

      if (tribeResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_TRIBE',
            message: 'Tribe does not exist',
            requestId: request.id,
          },
        });
      }

      // Hash password and create user
      const passwordHash = await bcrypt.hash(password, 12);
      const userId = uuidv4();
      const referralCodeNew = referralService.generateReferralCode(userId, tribeId);

      // Handle referral
      const { referrerId: referredBy } = await referralService.resolveReferrerId(fastify, referralCode);

      // Determine cohort (first 500: Vanguard 500, next 500: Centurion, post-25k: Centurion Legion)
      const usersTotalCount = await fastify.redis.incr('users:total_count');

      let cohort = null;
      if (usersTotalCount <= 500) {
        cohort = 'vanguard_500';
      } else if (usersTotalCount <= 1000) {
        cohort = 'centurion';
      } else if (usersTotalCount > 25000) {
        cohort = 'centurion_legion';
      }

      // START TRANSACTION
      const client = await fastify.db.connect();
      let userResult;
      try {
        await client.query('BEGIN');

        userResult = await client.query(
          `INSERT INTO users (id, username, email, password_hash, tribe_id, referred_by, referral_code, cohort, goal_tokens)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, username, email, tribe_id, elo, battles_played, battles_won, created_at, cohort, goal_tokens`,
          [userId, username, email, passwordHash, tribeId, referredBy, referralCodeNew, cohort, trialTokens || 0]
        );

        // Add user to tribe_members
        await client.query(
          `INSERT INTO tribe_members (user_id, tribe_id) VALUES ($1, $2)`,
          [userId, tribeId]
        );

        // Update tribe member count
        await client.query(
          `UPDATE tribes SET member_count = member_count + 1 WHERE id = $1`,
          [tribeId]
        );

        await client.query('COMMIT');
      } catch (transactionErr) {
        await client.query('ROLLBACK');
        throw transactionErr;
      } finally {
        client.release();
      }

      // Trigger milestones if applicable (AFTER successful registration)
      if (usersTotalCount === 25000) {
        trigger25kMilestone(fastify, userId).catch(err => fastify.log.error(err, '25k Milestone trigger failed'));
      } else if (usersTotalCount === 50000) {
        trigger50kMilestone(fastify, userId).catch(err => fastify.log.error(err, '50k Milestone trigger failed'));
      }

      // Tribal Catch-Up & Bounty Logic
      await processTribalCatchup(fastify, { userId, tribeId });

      // Record referral attribution if applicable
      if (referredBy) {
        await referralService.recordReferralAttribution(fastify, {
          referrerId: referredBy,
          recruitId: userId,
          referralCode: referralCode.toUpperCase(),
          tribeId,
          source: 'web_register',
        });
      }

      // Initialize user in Redis leaderboard
      await fastify.redis.zadd('leaderboard:global', 1000, userId);

      // Generate JWT
      const token = fastify.jwt.sign({
        id: userId,
        username,
        tribeId,
      });

      return reply.status(201).send({
        success: true,
        data: {
          user: userResult.rows[0],
          token,
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
          message: 'Failed to create account',
          requestId: request.id,
        },
      });
    }
  });

  // POST /auth/login - Authenticate and returns JWT
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    try {
      const result = await fastify.db.query(
        `SELECT id, username, email, password_hash, tribe_id, elo, 
                battles_played, battles_won, created_at 
         FROM users WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            requestId: request.id,
          },
        });
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            requestId: request.id,
          },
        });
      }

      // Update last active
      await fastify.db.query(
        `UPDATE users SET last_active_at = NOW() WHERE id = $1`,
        [user.id]
      );

      // Generate JWT
      const token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        tribeId: user.tribe_id,
      });

      // Remove password_hash from response
      delete user.password_hash;

      return reply.send({
        success: true,
        data: {
          user,
          token,
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
          message: 'Failed to authenticate',
          requestId: request.id,
        },
      });
    }
  });

  // POST /auth/phone-signup - Initiate phone signup/login
  fastify.post('/phone-signup', {
    schema: {
      body: {
        type: 'object',
        required: ['phoneNumber'],
        properties: {
          phoneNumber: { type: 'string', minLength: 10, maxLength: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { phoneNumber } = request.body;
    try {
      await otpService.generateAndSendOTP(fastify, phoneNumber);
      return reply.send({
        success: true,
        message: 'OTP sent successfully',
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send OTP',
          requestId: request.id,
        },
      });
    }
  });

  // POST /auth/verify-otp - Verify OTP and complete signup/login
  fastify.post('/verify-otp', {
    schema: {
      body: {
        type: 'object',
        required: ['phoneNumber', 'code'],
        properties: {
          phoneNumber: { type: 'string' },
          code: { type: 'string', minLength: 6, maxLength: 6 },
          username: { type: 'string', minLength: 3, maxLength: 50 },
          tribeId: { type: 'string', format: 'uuid' },
          referralCode: { type: 'string' },
          trialTokens: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { phoneNumber, code, username, tribeId, referralCode, trialTokens } = request.body;
    
    try {
      const otpResult = await otpService.verifyOTP(fastify, phoneNumber, code);
      if (!otpResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_OTP',
            message: otpResult.error,
            requestId: request.id,
          },
        });
      }

      const verificationId = otpResult.id;

      // Check if user exists
      let userResult = await fastify.db.query(
        `SELECT id, username, phone_number, tribe_id, elo, 
                battles_played, battles_won, created_at 
         FROM users WHERE phone_number = $1`,
        [phoneNumber]
      );

      let user;
      if (userResult.rows.length === 0) {
        // New user - registration required
        if (!username || !tribeId) {
          return reply.send({
            success: true,
            data: {
              registrationRequired: true,
              phoneNumber,
            },
            meta: {
              timestamp: new Date().toISOString(),
              requestId: request.id,
            },
          });
        }

        // Verify tribe exists
        const tribeResult = await fastify.db.query(
          'SELECT id FROM tribes WHERE id = $1',
          [tribeId]
        );

        if (tribeResult.rows.length === 0) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_TRIBE',
              message: 'Tribe does not exist',
              requestId: request.id,
            },
          });
        }

        // Check if username taken
        const usernameCheck = await fastify.db.query(
          'SELECT id FROM users WHERE username = $1',
          [username]
        );
        if (usernameCheck.rows.length > 0) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'USERNAME_TAKEN',
              message: 'Username already exists',
              requestId: request.id,
            },
          });
        }

        // Handle referral
        const { referrerId: referredBy } = await referralService.resolveReferrerId(fastify, referralCode);

        // Create user
        const userId = uuidv4();
        const referralCodeNew = referralService.generateReferralCode(userId, tribeId);

        // Determine cohort (first 500: Vanguard 500, next 500: Centurion, post-25k: Centurion Legion)
        const usersTotalCount = await fastify.redis.incr('users:total_count');

        let cohort = null;
        if (usersTotalCount <= 500) {
          cohort = 'vanguard_500';
        } else if (usersTotalCount <= 1000) {
          cohort = 'centurion';
        } else if (usersTotalCount > 25000) {
          cohort = 'centurion_legion';
        }

        // START TRANSACTION
        const client = await fastify.db.connect();
        try {
          await client.query('BEGIN');

          const newUserResult = await client.query(
            `INSERT INTO users (id, username, phone_number, tribe_id, referred_by, referral_code, cohort, goal_tokens)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, username, phone_number, tribe_id, elo, battles_played, battles_won, created_at, cohort, goal_tokens`,
            [userId, username, phoneNumber, tribeId, referredBy, referralCodeNew, cohort, trialTokens || 0]
          );
          user = newUserResult.rows[0];

          // Add user to tribe_members
          await client.query(
            `INSERT INTO tribe_members (user_id, tribe_id) VALUES ($1, $2)`,
            [userId, tribeId]
          );

          // Update tribe member count
          await client.query(
            `UPDATE tribes SET member_count = member_count + 1 WHERE id = $1`,
            [tribeId]
          );

          await client.query('COMMIT');
        } catch (transactionErr) {
          await client.query('ROLLBACK');
          throw transactionErr;
        } finally {
          client.release();
        }

        // Trigger milestones if applicable (AFTER successful registration)
        if (usersTotalCount === 25000) {
          trigger25kMilestone(fastify, userId).catch(err => fastify.log.error(err, '25k Milestone trigger failed'));
        } else if (usersTotalCount === 50000) {
          trigger50kMilestone(fastify, userId).catch(err => fastify.log.error(err, '50k Milestone trigger failed'));
        }

        // Tribal Catch-Up & Bounty Logic
        await processTribalCatchup(fastify, { userId, tribeId });

        // Record referral attribution if applicable
        if (referredBy) {
          await referralService.recordReferralAttribution(fastify, {
            referrerId: referredBy,
            recruitId: userId,
            referralCode: referralCode.toUpperCase(),
            tribeId,
            source: 'phone_signup',
          });
        }

        // Initialize user in Redis leaderboard
        await fastify.redis.zadd('leaderboard:global', 1000, userId);
      } else {
        user = userResult.rows[0];
      }

      // Finalize: Mark OTP as used
      await otpService.markAsUsed(fastify, verificationId);

      // Update last active
      await fastify.db.query(
        `UPDATE users SET last_active_at = NOW() WHERE id = $1`,
        [user.id]
      );

      // Generate JWT
      const token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        tribeId: user.tribe_id,
      });

      return reply.send({
        success: true,
        data: {
          user,
          token,
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
          message: 'Failed to verify OTP',
          requestId: request.id,
        },
      });
    }
  });

  // POST /auth/guest - Create a guest session
  fastify.post('/guest', {
    schema: {
      body: {
        type: 'object',
        required: ['tribeId'],
        properties: {
          tribeId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { tribeId } = request.body;
    try {
      const user = await guestService.createGuest(fastify, { tribeId });
      
      const token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        tribeId: user.tribe_id,
        isGuest: true
      });

      return reply.status(201).send({
        success: true,
        data: { user, token },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create guest session' },
      });
    }
  });

  // POST /auth/convert-guest - Convert guest session to real account
  fastify.post('/convert-guest', {
    schema: {
      body: {
        type: 'object',
        required: ['guestId', 'username', 'email', 'password'],
        properties: {
          guestId: { type: 'string', format: 'uuid' },
          username: { type: 'string', minLength: 3 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          tribeId: { type: 'string', format: 'uuid' },
          referralCode: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { guestId, username, email, password, tribeId, referralCode } = request.body;
    try {
      const user = await guestService.convertGuestToUser(fastify, guestId, {
        username, email, password, tribeId, referralCode
      });

      const token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        tribeId: user.tribe_id,
      });

      return reply.send({
        success: true,
        data: { user, token },
      });
    } catch (err) {
      if (err.message === 'USER_EXISTS') {
        return reply.status(409).send({
          success: false,
          error: { code: 'USER_EXISTS', message: 'Username or email already exists' },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  });
};

export default authRoutes;
