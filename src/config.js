import 'dotenv/config';

// Resolve SSL settings for the PostgreSQL pool:
// - DB_SSL=true/false wins outright
// - otherwise derive from DATABASE_URL's sslmode query param
// - otherwise default to SSL in production, no SSL in development
function resolveSsl() {
  if (process.env.DB_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.DB_SSL === 'false') return false;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const sslmode = new URL(databaseUrl).searchParams.get('sslmode');
      if (sslmode && sslmode !== 'disable') return { rejectUnauthorized: false };
      if (sslmode === 'disable') return false;
    } catch {
      // Ignore malformed URLs and fall through to the default below.
    }
  }

  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
}

const config = {
  app: {
    port: parseInt(process.env.PORT || '8080'),
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'goalmind',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: resolveSsl(),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'goalmind-super-secret-jwt-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'goalmind-refresh-secret-key',
    expiresIn: '1h',
    refreshExpiresIn: '30d',
  },
  battle: {
    roundTimeMs: 10000,
    interRoundTimeMs: 3000,
    maxResponseTimeMs: 10000,
    minResponseTimeMs: 500,
    totalRounds: 5,
    freeTierDailyLimit: 5,
  },
  elo: {
    kFactorNewPlayer: 32,
    kFactorEstablished: 16,
    kFactorVeteran: 8,
    newPlayerBattleThreshold: 20,
    veteranBattleThreshold: 100,
  },
  matchmaking: {
    eloRangeInitial: 50,
    eloRangeExpansion: 25,
    expansionIntervalMs: 10000,
    timeoutMs: 60000,
  },
};

export default config;
