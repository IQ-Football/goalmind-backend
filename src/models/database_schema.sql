-- GoalMind Database Schema
-- PostgreSQL initialization script

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users and Authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tribe_id UUID,
    elo INTEGER DEFAULT 1000,
    battles_played INTEGER DEFAULT 0,
    battles_won INTEGER DEFAULT 0,
    last_active_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Tribal Identity System
CREATE TABLE IF NOT EXISTS tribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('club', 'city', 'university')),
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url VARCHAR(500),
    primary_color VARCHAR(7),
    secondary_color VARCHAR(7),
    rival_tribe_ids UUID[] DEFAULT '{}',
    total_points INTEGER DEFAULT 0,
    member_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tribe_members (
    user_id UUID REFERENCES users(id) PRIMARY KEY,
    tribe_id UUID REFERENCES tribes(id),
    tier VARCHAR(20) DEFAULT 'Supporter' CHECK (tier IN ('Supporter', 'Ultra', 'Legend')),
    contribution_points INTEGER DEFAULT 0,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Question Bank (created before battle_rounds to avoid FK issues)
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option_index INTEGER NOT NULL,
    difficulty VARCHAR(10) CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
    category VARCHAR(50),
    tags VARCHAR[],
    source_match_id VARCHAR(100),
    explanation TEXT,
    tribe_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Battle System
CREATE TABLE IF NOT EXISTS battles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player1_id UUID REFERENCES users(id),
    player2_id UUID REFERENCES users(id),
    winner_id UUID REFERENCES users(id),
    player1_score INTEGER DEFAULT 0,
    player2_score INTEGER DEFAULT 0,
    player1_elo_change INTEGER DEFAULT 0,
    player2_elo_change INTEGER DEFAULT 0,
    tribe_points_awarded INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS battle_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID REFERENCES battles(id),
    question_id UUID,
    round_number INTEGER NOT NULL,
    player1_answer UUID,
    player1_response_time_ms INTEGER,
    player1_points INTEGER DEFAULT 0,
    player2_answer UUID,
    player2_response_time_ms INTEGER,
    player2_points INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Achievements & Progression
CREATE TABLE IF NOT EXISTS achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    badge_url VARCHAR(500),
    criteria JSONB NOT NULL,
    tier VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id UUID REFERENCES users(id),
    achievement_id UUID REFERENCES achievements(id),
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_tribe ON users(tribe_id);
CREATE INDEX IF NOT EXISTS idx_battles_player1 ON battles(player1_id);
CREATE INDEX IF NOT EXISTS idx_battles_player2 ON battles(player2_id);
CREATE INDEX IF NOT EXISTS idx_battles_created ON battles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_tribe ON questions(tribe_id);
CREATE INDEX IF NOT EXISTS idx_tribes_type ON tribes(type);
CREATE INDEX IF NOT EXISTS idx_tribes_points ON tribes(total_points DESC);

-- Add foreign key from users to tribes after tribes table exists
DO $ BEGIN
  ALTER TABLE users ADD CONSTRAINT fk_users_tribe FOREIGN KEY (tribe_id) REFERENCES tribes(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $;

-- Seasonal Leagues System
CREATE TABLE IF NOT EXISTS leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    tier INTEGER NOT NULL CHECK (tier >= 1 AND tier <= 6), -- 1=Sunday League to 6=GOAT
    slug VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    min_elo INTEGER DEFAULT 0,
    max_elo INTEGER DEFAULT 9999,
    promotion_threshold_percent INTEGER DEFAULT 10, -- Top 10% promote
    relegation_threshold_percent INTEGER DEFAULT 20, -- Bottom 20% relegate
    season_number INTEGER DEFAULT 1,
    season_start_date TIMESTAMP WITH TIME ZONE,
    season_end_date TIMESTAMP WITH TIME ZONE,
    season_duration_days INTEGER DEFAULT 28,
    offseason_duration_days INTEGER DEFAULT 3,
    reward_badge_name VARCHAR(100),
    reward_goal_tokens INTEGER DEFAULT 0,
    current_season_start DATE,
    current_season_end DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS league_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    league_id UUID REFERENCES leagues(id),
    season_id UUID,
    elo_at_season_start INTEGER DEFAULT 0,
    current_elo INTEGER DEFAULT 0,
    league_points INTEGER DEFAULT 0,
    wins_count INTEGER DEFAULT 0,
    draws_count INTEGER DEFAULT 0,
    losses_count INTEGER DEFAULT 0,
    battles_played INTEGER DEFAULT 0,
    battles_won INTEGER DEFAULT 0,
    battles_drawn INTEGER DEFAULT 0,
    battles_lost INTEGER DEFAULT 0,
    current_win_streak INTEGER DEFAULT 0,
    longest_win_streak INTEGER DEFAULT 0,
    rank INTEGER DEFAULT 0,
    previous_rank INTEGER,
    is_promoted BOOLEAN DEFAULT false,
    is_relegated BOOLEAN DEFAULT false,
    last_battle_at TIMESTAMP WITH TIME ZONE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, league_id, season_id)
);

-- Indexes for League Performance
CREATE INDEX IF NOT EXISTS idx_leagues_tier ON leagues(tier);
CREATE INDEX IF NOT EXISTS idx_leagues_active ON leagues(is_active);
CREATE INDEX IF NOT EXISTS idx_participants_user ON league_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_league ON league_participants(league_id);
CREATE INDEX IF NOT EXISTS idx_participants_rank ON league_participants(rank);

-- Solo Challenges & Quests System
CREATE TABLE IF NOT EXISTS quests (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('daily', 'weekly')),
    requirement JSONB NOT NULL,
    reward JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    quest_id VARCHAR(50) REFERENCES quests(id),
    quest_type VARCHAR(20) NOT NULL,
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, quest_id)
);

-- Historical Scenario Results
CREATE TABLE IF NOT EXISTS historical_scenario_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    scenario_id VARCHAR(50) NOT NULL,
    score_percent INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    passed BOOLEAN DEFAULT false,
    answers JSONB,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, scenario_id)
);

-- Indexes for Solo Challenges
CREATE INDEX IF NOT EXISTS idx_user_quests_user ON user_quests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_quests_type ON user_quests(quest_type);
CREATE INDEX IF NOT EXISTS idx_scenario_results_user ON historical_scenario_results(user_id);

