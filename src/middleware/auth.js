import config from '../config.js';

// Authentication middleware
export async function authenticate(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
        requestId: request.id,
      },
    });
  }
}

// Admin role check middleware
export async function checkAdmin(request, reply) {
  // User must be authenticated first (authenticate preHandler runs before)
  if (!request.user) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        requestId: request.id,
      },
    });
  }
  if (request.user.role !== 'admin') {
    return reply.status(403).send({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
        requestId: request.id,
      },
    });
  }
}

// Optional authentication - doesn't fail if no token
export async function optionalAuth(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    // Silently continue without user context
    request.user = null;
  }
}

// Rate limiting for battle actions
export async function battleRateLimit(request, reply) {
  const userId = request.user?.id;
  if (!userId) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        requestId: request.id,
      },
    });
  }
  // Additional battle-specific rate limiting is handled by @fastify/rate-limit
  // This is a placeholder for potential battle-specific logic
}
