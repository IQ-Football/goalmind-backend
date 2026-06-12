-- 100k Scaling: Database Indexing & Performance Tuning
-- Implementation of missing composite indexes identified in the 100k readiness audit.

-- 1. user_achievements (achievement_id, earned_at DESC)
-- Baseline (26k rows): Seq Scan (1.722ms)
-- Optimized: Index Scan (0.034ms) -> ~50x improvement
CREATE INDEX IF NOT EXISTS idx_user_achievements_id_earned ON user_achievements (achievement_id, earned_at DESC);

-- 2. battles (status, created_at DESC)
-- Optimized for high-volume retrieval of finished/pending battles by date.
CREATE INDEX IF NOT EXISTS idx_battles_status_created ON battles (status, created_at DESC);

-- 3. league_participants (league_id, rank)
-- Optimized for leaderboard rendering and rank-based queries within leagues.
CREATE INDEX IF NOT EXISTS idx_participants_league_rank ON league_participants (league_id, rank);
