
/**
 * Discovery Routes
 * 
 * Endpoints for onboarding discovery, Geo-IP tribe suggestions, and unified configs.
 */

const discoveryRoutes = async (fastify, options) => {

  // GET /suggest-tribe — Suggest a tribe based on the user's IP (Geo-IP)
  fastify.get('/suggest-tribe', async (request, reply) => {
    const countryCode = (request.headers['cf-ipcountry'] || request.headers['x-country-code'] || 'NG').toUpperCase(); 
    const cacheKey = `cache:discovery:suggest:${countryCode}`;
    
    try {
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      // Map country codes to region/tribe
      const countryToTribeMapping = {
        'EG': 'al-ahly',         // Egypt -> Al Ahly
        'MA': 'raja-casablanca', // Morocco -> Raja
        'TN': 'esperance-de-tunis', // Tunisia -> Esperance
        'ZA': 'kaizer-chiefs',   // South Africa -> Kaizer Chiefs
        'TZ': 'simba-sc',        // Tanzania -> Simba
        'GH': 'asante-kotoko',   // Ghana -> Asante Kotoko
        'NG': 'enyimba-fc',      // Nigeria -> Enyimba
        'CD': 'tp-mazembe',      // DR Congo -> TP Mazembe
      };

      const suggestedSlug = countryToTribeMapping[countryCode.toUpperCase()] || 'al-ahly'; // Default to Al Ahly if no mapping

      const tribeResult = await fastify.db.query(
        'SELECT id, name, slug, logo_url, primary_color, secondary_color, region FROM tribes WHERE slug = $1',
        [suggestedSlug]
      );

      const suggestion = tribeResult.rows[0] || null;

      const response = {
        success: true,
        data: {
          countryCode,
          suggestedTribe: suggestion,
          reason: suggestion ? `Popular in your region (${suggestion.region})` : 'Default global recommendation'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      };

      await fastify.redis.set(cacheKey, JSON.stringify(response), 'EX', 3600); // Cache for 1 hour
      return reply.send(response);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to suggest tribe' }
      });
    }
  });

  // GET /health — Health Check for Frontend (Connectivity test)
  fastify.get('/health', async (request, reply) => {
    return reply.send({
      success: true,
      data: {
        status: 'online',
        version: '1.2.0',
        environment: process.env.NODE_ENV || 'development',
        surgeCohort: 'Centurion Legion'
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  });
};

export default discoveryRoutes;
