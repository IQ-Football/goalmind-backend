# GoalMind Backend

Competitive Football IQ Arena - Backend API Server

## Quick Start

```bash
# Install dependencies
npm install

# Initialize database (creates tables and seeds data)
npm run db:init

# Start server
npm start

# Development mode with watch
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | API server port |
| `NODE_ENV` | development | Environment |
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | goalmind | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | postgres | Database password |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `JWT_SECRET` | (default) | JWT signing secret |

## API Endpoints

### Auth
- `POST /auth/register` - Create account
- `POST /auth/login` - Login

### Users
- `GET /users/me` - Current user profile
- `GET /users/:id/stats` - Public stats

### Tribes
- `GET /tribes` - List all tribes
- `GET /tribes/:id` - Tribe details
- `GET /tribes/:id/leaderboard` - Tribe rankings

### Leaderboard
- `GET /leaderboard/global` - Global top 100
- `GET /leaderboard/tribal` - Tribe power rankings

### Battles
- `GET /battles/history` - Battle history
- `POST /battles/challenge` - Direct challenge

### Solo
- `POST /solo/challenges` - Start challenge
- `GET /solo/daily` - Daily quiz

### Achievements
- `GET /achievements` - User's badges
- `GET /achievements/all` - All badges

## WebSocket Events

### Battle Namespace (`/battle`)
- `battle:join` - Join battle
- `battle:answer` - Submit answer
- `battle:emoji` - Send emoji
- `battle:forfeit` - Forfeit

### Matchmaking Namespace (`/matchmaking`)
- `matchmaking:join` - Enter queue
- `matchmaking:leave` - Exit queue
// PAT verification commit
