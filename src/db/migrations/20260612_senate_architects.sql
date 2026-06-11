-- Migration: Senate and Architects support
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_senate_member BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_obsidian_glow BOOLEAN DEFAULT false;

-- Index for cohort queries
CREATE INDEX IF NOT EXISTS idx_users_senate ON users(is_senate_member);
