-- Migration: League System Tables
-- Creates: league_seasons, league_groups, league_group_members, league_pr_log

BEGIN;

-- league_seasons: Tracks active and historical seasons
CREATE TABLE IF NOT EXISTS league_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'upcoming',
  promoted_users JSONB DEFAULT '[]',
  relegated_users JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_ls_league ON league_seasons(league_id);
CREATE INDEX IF NOT EXISTS idx_ls_status ON league_seasons(status);
CREATE INDEX IF NOT EXISTS idx_ls_dates ON league_seasons(start_date, end_date);

-- league_groups: 30-player groups within divisions
CREATE TABLE IF NOT EXISTS league_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  season_id UUID REFERENCES league_seasons(id),
  group_number INTEGER NOT NULL,
  name VARCHAR(50) NOT NULL,
  max_size INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, season_id, group_number)
);

CREATE INDEX IF NOT EXISTS idx_lg_league ON league_groups(league_id);

-- league_group_members: Maps users to groups
CREATE TABLE IF NOT EXISTS league_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES league_groups(id),
  user_id UUID NOT NULL REFERENCES users(id),
  participant_id UUID NOT NULL REFERENCES league_participants(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lgm_member ON league_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_lgm_group ON league_group_members(group_id);

-- league_pr_log: Historical P&R tracking
CREATE TABLE IF NOT EXISTS league_pr_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  league_id UUID NOT NULL REFERENCES leagues(id),
  season_id UUID REFERENCES league_seasons(id),
  action VARCHAR(20) NOT NULL,
  from_group INTEGER,
  to_group INTEGER,
  from_rank INTEGER,
  to_rank INTEGER,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prl_user ON league_pr_log(user_id);

COMMIT;