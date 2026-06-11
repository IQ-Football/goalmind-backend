-- Migration: Add Founding Rewards support
-- 1. Add columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_frame VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rewards_claimed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_tokens INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_xp INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cohort VARCHAR(50);

-- 2. Create goaltoken_ledger table if it doesn't exist
CREATE TABLE IF NOT EXISTS goaltoken_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    amount INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Ensure hall_of_generals table exists (if not already handled)
CREATE TABLE IF NOT EXISTS hall_of_generals (
    user_id UUID REFERENCES users(id),
    tribe_id UUID REFERENCES tribes(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, tribe_id)
);

-- 4. Create index for performance
CREATE INDEX IF NOT EXISTS idx_ledger_user_id ON goaltoken_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_users_cohort ON users(cohort);
