import fp from 'fastify-plugin';

/**
 * Database Connection Pool Monitoring Plugin
 * Tracks connection pool utilization and emits alerts when > 80% used
 */
async function dbMonitorPlugin(fastify, options) {
  const alertThreshold = 0.80; // 80% utilization threshold
  let lastAlertTime = 0;
  const alertCooldownMs = 60000; // Don't spam alerts more than once per minute

  // Expose pool stats via decorated method
  fastify.db.poolMonitor = {
    /**
     * Get current pool statistics
     */
    async getStats() {
      try {
        // Query pg_stat_activity for connection info
        const result = await fastify.db.query(`
          SELECT 
            COUNT(*) FILTER (WHERE state = 'active') as active_connections,
            COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
            COUNT(*) as total_connections,
            COUNT(*) FILTER (WHERE state = 'active' AND query_start < NOW() - INTERVAL '10 seconds') as long_running_queries,
            MAX(query_start) as oldest_query_start
          FROM pg_stat_activity 
          WHERE datname = current_database()
            AND pid != pg_backend_pid()
        `);

        const pool = fastify.db.pool;
        const stats = {
          pool: {
            total: pool.options.max || 20,
            idle: pool.idleCount,
            used: pool.totalCount - pool.idleCount,
            available: pool.available,
          },
          database: result.rows[0] || {},
          utilizationPercent: 0,
          timestamp: new Date().toISOString(),
        };

        if (stats.pool.total > 0) {
          stats.utilizationPercent = (stats.pool.used / stats.pool.total) * 100;
        }

        return stats;
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get pool stats');
        return null;
      }
    },

    /**
     * Check if pool utilization exceeds threshold and alert if needed
     */
    async checkAndAlert() {
      const stats = await this.getStats();
      if (!stats) return null;

      const now = Date.now();
      const isOverThreshold = stats.utilizationPercent > (alertThreshold * 100);

      if (isOverThreshold && (now - lastAlertTime) > alertCooldownMs) {
        lastAlertTime = now;
        fastify.log.warn({
          utilizationPercent: stats.utilizationPercent.toFixed(1),
          used: stats.pool.used,
          total: stats.pool.total,
          activeDbConnections: stats.database.active_connections,
          idleDbConnections: stats.database.idle_connections,
        }, '⚠️  Database connection pool utilization exceeds 80%');
      }

      return stats;
    },
  };

  // Health check endpoint for pool monitoring
  fastify.get('/health/db', async (request, reply) => {
    const stats = await fastify.db.poolMonitor.getStats();
    if (!stats) {
      return reply.status(503).send({
        success: false,
        error: { code: 'DB_UNAVAILABLE', message: 'Could not retrieve database stats' },
      });
    }

    const isHealthy = stats.utilizationPercent < (alertThreshold * 100);

    return reply.send({
      success: true,
      data: {
        healthy: isHealthy,
        utilizationPercent: Math.round(stats.utilizationPercent),
        poolUsed: stats.pool.used,
        poolTotal: stats.pool.total,
        activeDbConnections: parseInt(stats.database.active_connections || 0),
        idleDbConnections: parseInt(stats.database.idle_connections || 0),
        longRunningQueries: parseInt(stats.database.long_running_queries || 0),
      },
      meta: { timestamp: stats.timestamp },
    });
  });

  // Periodic monitoring every 10 seconds
  const monitorInterval = setInterval(async () => {
    try {
      await fastify.db.poolMonitor.checkAndAlert();
    } catch (err) {
      fastify.log.error({ err }, 'Pool monitoring check failed');
    }
  }, 10000);

  fastify.addHook('onClose', async () => {
    clearInterval(monitorInterval);
  });

  fastify.log.info('Database pool monitoring initialized');
}

export default fp(dbMonitorPlugin);
