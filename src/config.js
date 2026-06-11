const config = {
  app: {
    port: parseInt(process.env.PORT || '8080'),
    env: process.env.NODE_ENV || 'development',
    domain: process.env.DOMAIN || 'iqfootballarena.io',
    allowedOrigins: [
      'https://iqfootballarena.io',
      'https://www.iqfootballarena.io',
      'http://localhost:3000', // Local development
    ]
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'goalmind',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
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
