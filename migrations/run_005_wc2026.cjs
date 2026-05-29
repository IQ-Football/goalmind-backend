// WC 2026 Migration: National Tribes, Knockout Brackets, Predictions, VAR Events
const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function migrate() {
  const client = await pool.connect();
  try {
    // 1. National Tribes (temporary WC identity)
    await client.query(`
      CREATE TABLE IF NOT EXISTS national_tribes (
        id            VARCHAR(10) PRIMARY KEY,   -- ISO 3166-1 alpha-2 code (AR, BR, FR, etc.)
        name          VARCHAR(100) NOT NULL,
        flag_emoji   VARCHAR(10),
        group_letter CHAR(1),                  -- A-H for group stage
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('national_tribes table OK');

    // User's active national tribe (temporary during WC window)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_national_tribes (
        user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        national_tribe_id VARCHAR(10) NOT NULL REFERENCES national_tribes(id),
        selected_at       TIMESTAMPTZ DEFAULT NOW(),
        national_pride_score INTEGER DEFAULT 0,
        PRIMARY KEY (user_id)
      );
    `);
    console.log('user_national_tribes table OK');

    // 2. WC 2026 Matches (for predictions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS wc2026_matches (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_number    INTEGER NOT NULL UNIQUE,
        stage           VARCHAR(30) NOT NULL CHECK (stage IN ('group','round_of_16','quarter','semi','third_place','final')),
        match_date      TIMESTAMPTZ,
        team1_id        VARCHAR(10) REFERENCES national_tribes(id),
        team2_id        VARCHAR(10) REFERENCES national_tribes(id),
        team1_score     INTEGER,
        team2_score     INTEGER,
        status          VARCHAR(20) DEFAULT 'upcoming' CHECK (status IN ('upcoming','live','completed','postponed')),
        match_type      VARCHAR(30) DEFAULT 'standard',  -- 'standard', 'halftime_blitz', 'var_battle'
        is_active       BOOLEAN DEFAULT false,           -- triggers prediction/VAR battles
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('wc2026_matches table OK');

    // 3. User Predictions
    await client.query(`
      CREATE TABLE IF NOT EXISTS wc2026_predictions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id),
        match_id        UUID NOT NULL REFERENCES wc2026_matches(id),
        predicted_winner VARCHAR(10),   -- team1/team2/draw
        predicted_team1_score INTEGER,
        predicted_team2_score INTEGER,
        predicted_first_scorer VARCHAR(100),
        multiplier_active  BOOLEAN DEFAULT false,  -- 2x IQ for next hour
        multiplier_expires TIMESTAMPTZ,
        points_earned     INTEGER DEFAULT 0,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, match_id)
      );
    `);
    console.log('wc2026_predictions table OK');

    // 4. VAR Battle Events (triggered during live reviews)
    await client.query(`
      CREATE TABLE IF NOT EXISTS wc2026_var_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id        UUID NOT NULL REFERENCES wc2026_matches(id),
        event_minute    INTEGER,
        var_type        VARCHAR(50) CHECK (var_type IN ('penalty','offside','goal_disallowed','red_card','penalty_saved','handball')),
        description     TEXT,
        triggered_at    TIMESTAMPTZ DEFAULT NOW(),
        is_active       BOOLEAN DEFAULT true,
        expires_at      TIMESTAMPTZ  -- 60 seconds to enter VAR battle
      );
    `);
    console.log('wc2026_var_events table OK');

    // 5. Knockout Brackets (single-elimination)
    await client.query(`
      CREATE TABLE IF NOT EXISTS knockout_brackets (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bracket_name     VARCHAR(50) NOT NULL,  -- 'world_cup_2026_finals'
        round            INTEGER NOT NULL,     -- 1=round16, 2=quarter, 3=semi, 4=final
        match_slot       INTEGER NOT NULL,     -- which slot in the bracket
        team1_user_id    UUID REFERENCES users(id),
        team2_user_id    UUID REFERENCES users(id),
        team1_nation_id  VARCHAR(10) REFERENCES national_tribes(id),
        team2_nation_id  VARCHAR(10) REFERENCES national_tribes(id),
        team1_score      INTEGER DEFAULT 0,
        team2_score      INTEGER DEFAULT 0,
        winner_user_id   UUID REFERENCES users(id),
        winner_nation_id VARCHAR(10) REFERENCES national_tribes(id),
        status           VARCHAR(20) DEFAULT 'pending',
        is_sudden_death  BOOLEAN DEFAULT false,
        started_at       TIMESTAMPTZ,
        completed_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('knockout_brackets table OK');

    // 6. Knockout Entries (user's entry into knockout league)
    await client.query(`
      CREATE TABLE IF NOT EXISTS knockout_entries (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id),
        bracket_id      UUID NOT NULL REFERENCES knockout_brackets(id),
        streak_wins     INTEGER DEFAULT 0,
        eliminated      BOOLEAN DEFAULT false,
        knockout_trophy BOOLEAN DEFAULT false,  -- 4 wins in a row
        entered_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, bracket_id)
      );
    `);
    console.log('knockout_entries table OK');

    // 7. User WC stats
    await client.query(`
      CREATE TABLE IF NOT EXISTS wc2026_user_stats (
        user_id          UUID PRIMARY KEY REFERENCES users(id),
        national_tribe_id VARCHAR(10) REFERENCES national_tribes(id),
        predictions_made  INTEGER DEFAULT 0,
        predictions_correct INTEGER DEFAULT 0,
        var_battles_entered INTEGER DEFAULT 0,
        var_battles_won   INTEGER DEFAULT 0,
        knockout_trophies INTEGER DEFAULT 0,
        halftime_blitz_played INTEGER DEFAULT 0,
        multiplier_seconds_left INTEGER DEFAULT 0,
        total_iq_earned  INTEGER DEFAULT 0,
        last_updated     TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('wc2026_user_stats table OK');

    // 8. World Champion Reward tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS wc2026_champion_rewards (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        winning_nation_id VARCHAR(10) REFERENCES national_tribes(id),
        badge_granted     BOOLEAN DEFAULT false,
        gems_distributed  BOOLEAN DEFAULT false,
        legacy_skin_granted BOOLEAN DEFAULT false,
        awarded_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('wc2026_champion_rewards table OK');

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wc2026_matches_stage ON wc2026_matches(stage);
      CREATE INDEX IF NOT EXISTS idx_wc2026_matches_status ON wc2026_matches(status);
      CREATE INDEX IF NOT EXISTS idx_wc2026_matches_active ON wc2026_matches(is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_predictions_user ON wc2026_predictions(user_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_match ON wc2026_predictions(match_id);
      CREATE INDEX IF NOT EXISTS idx_var_events_match ON wc2026_var_events(match_id);
      CREATE INDEX IF NOT EXISTS idx_var_events_active ON wc2026_var_events(is_active, expires_at) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_knockout_entries_user ON knockout_entries(user_id);
    `);
    console.log('Indexes created OK');

    // Seed 48 national tribes (all WC 2026 qualified nations)
    const nations = [
      { id: 'AR', name: 'Argentina', flag: '🇦🇷', group: 'A' },
      { id: 'AT', name: 'Austria', flag: '🇦🇹', group: 'D' },
      { id: 'AU', name: 'Australia', flag: '🇦🇺', group: 'B' },
      { id: 'BE', name: 'Belgium', flag: '🇧🇪', group: 'E' },
      { id: 'BR', name: 'Brazil', flag: '🇧🇷', group: 'G' },
      { id: 'CM', name: 'Cameroon', flag: '🇨🇲', group: 'F' },
      { id: 'CA', name: 'Canada', flag: '🇨🇦', group: 'A' },
      { id: 'CL', name: 'Chile', flag: '🇨🇱', group: 'H' },
      { id: 'CO', name: 'Colombia', flag: '🇨🇴', group: 'E' },
      { id: 'HR', name: 'Croatia', flag: '🇭🇷', group: 'D' },
      { id: 'CZ', name: 'Czech Republic', flag: '🇨🇿', group: 'E' },
      { id: 'DK', name: 'Denmark', flag: '🇩🇰', group: 'C' },
      { id: 'EC', name: 'Ecuador', flag: '🇪🇨', group: 'B' },
      { id: 'EN', name: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', group: 'C' },
      { id: 'FR', name: 'France', flag: '🇫🇷', group: 'D' },
      { id: 'DE', name: 'Germany', flag: '🇩🇪', group: 'A' },
      { id: 'GH', name: 'Ghana', flag: '🇬🇭', group: 'F' },
      { id: 'GR', name: 'Greece', flag: '🇬🇷', group: 'E' },
      { id: 'HU', name: 'Hungary', flag: '🇭🇺', group: 'A' },
      { id: 'IR', name: 'Iran', flag: '🇮🇷', group: 'F' },
      { id: 'IE', name: 'Ireland', flag: '🇮🇪', group: 'D' },
      { id: 'IT', name: 'Italy', flag: '🇮🇹', group: 'B' },
      { id: 'JP', name: 'Japan', flag: '🇯🇵', group: 'C' },
      { id: 'KR', name: 'South Korea', flag: '🇰🇷', group: 'F' },
      { id: 'MA', name: 'Morocco', flag: '🇲🇦', group: 'F' },
      { id: 'MX', name: 'Mexico', flag: '🇲🇽', group: 'A' },
      { id: 'NL', name: 'Netherlands', flag: '🇳🇱', group: 'E' },
      { id: 'NZ', name: 'New Zealand', flag: '🇳🇿', group: 'C' },
      { id: 'NG', name: 'Nigeria', flag: '🇳🇬', group: 'F' },
      { id: 'NO', name: 'Norway', flag: '🇳🇴', group: 'A' },
      { id: 'PA', name: 'Panama', flag: '🇵🇦', group: 'B' },
      { id: 'PE', name: 'Peru', flag: '🇵🇪', group: 'H' },
      { id: 'PL', name: 'Poland', flag: '🇵🇱', group: 'C' },
      { id: 'PT', name: 'Portugal', flag: '🇵🇹', group: 'G' },
      { id: 'QA', name: 'Qatar', flag: '🇶🇦', group: 'A' },
      { id: 'RO', name: 'Romania', flag: '🇷🇴', group: 'E' },
      { id: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', group: 'C' },
      { id: 'SN', name: 'Senegal', flag: '🇸🇳', group: 'G' },
      { id: 'RS', name: 'Serbia', flag: '🇷🇸', group: 'G' },
      { id: 'SK', name: 'Slovakia', flag: '🇸🇰', group: 'F' },
      { id: 'ZA', name: 'South Africa', flag: '🇿🇦', group: 'E' },
      { id: 'ES', name: 'Spain', flag: '🇪🇸', group: 'B' },
      { id: 'SE', name: 'Sweden', flag: '🇸🇪', group: 'D' },
      { id: 'CH', name: 'Switzerland', flag: '🇨🇭', group: 'C' },
      { id: 'TN', name: 'Tunisia', flag: '🇹🇳', group: 'H' },
      { id: 'TR', name: 'Turkey', flag: '🇹🇷', group: 'E' },
      { id: 'UA', name: 'Ukraine', flag: '🇺🇦', group: 'D' },
      { id: 'AE', name: 'UAE', flag: '🇦🇪', group: 'H' },
      { id: 'US', name: 'United States', flag: '🇺🇸', group: 'B' },
      { id: 'UY', name: 'Uruguay', flag: '🇺🇾', group: 'H' },
    ];

    for (const n of nations) {
      await client.query(
        `INSERT INTO national_tribes (id, name, flag_emoji, group_letter) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [n.id, n.name, n.flag, n.group]
      );
    }
    console.log(`Seeded ${nations.length} national tribes`);

    // Seed sample WC matches
    const sampleMatches = [
      { num: 1, stage: 'group', team1: 'AR', team2: 'CA', date: '2026-06-11T22:00:00Z', status: 'upcoming' },
      { num: 2, stage: 'group', team1: 'MX', team2: 'QA', date: '2026-06-12T19:00:00Z', status: 'upcoming' },
      { num: 3, stage: 'group', team1: 'US', team2: 'DE', date: '2026-06-12T22:00:00Z', status: 'upcoming' },
      { num: 4, stage: 'group', team1: 'FR', team2: 'EN', date: '2026-06-13T19:00:00Z', status: 'upcoming' },
      { num: 5, stage: 'group', team1: 'BR', team2: 'PT', date: '2026-06-13T22:00:00Z', status: 'upcoming' },
      { num: 48, stage: 'final', team1: null, team2: null, date: '2026-07-19T22:00:00Z', status: 'upcoming' },
    ];

    for (const m of sampleMatches) {
      await client.query(
        `INSERT INTO wc2026_matches (match_number, stage, team1_id, team2_id, match_date, status)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (match_number) DO NOTHING`,
        [m.num, m.stage, m.team1, m.team2, m.date, m.status]
      );
    }
    console.log(`Seeded ${sampleMatches.length} WC matches`);

    // Verify
    const { rows: nationCount } = await client.query('SELECT COUNT(*) FROM national_tribes');
    const { rows: matchCount } = await client.query('SELECT COUNT(*) FROM wc2026_matches');
    console.log(`Total national tribes: ${nationCount[0].count}`);
    console.log(`Total WC matches: ${matchCount[0].count}`);

  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
