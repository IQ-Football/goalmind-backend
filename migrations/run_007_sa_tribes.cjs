// South Africa Tribe Data + Payments Tables Migration
const { Pool } = require('pg');
require('pg').defaults.ssl = false;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'goalmind', user: 'postgres', password: 'postgres' });

async function migrate() {
  const client = await pool.connect();
  try {
    // 1. Payments table for ZAR transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference       VARCHAR(100) UNIQUE NOT NULL,
        user_id         UUID REFERENCES users(id),
        amount          DECIMAL(10,2) NOT NULL,
        currency        VARCHAR(10) DEFAULT 'ZAR',
        status          VARCHAR(20) DEFAULT 'pending'
                         CHECK (status IN ('pending','completed','failed','refunded','cancelled')),
        plan            VARCHAR(50),
        provider        VARCHAR(20) DEFAULT 'paystack',
        provider_ref    VARCHAR(100),
        metadata        JSONB DEFAULT '{}',
        completed_at    TIMESTAMPTZ,
        refunded_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('payments table OK');

    // 2. Gem transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS gem_transactions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID REFERENCES users(id),
        amount          INTEGER NOT NULL,
        currency        VARCHAR(10) DEFAULT 'ZAR',
        provider        VARCHAR(20) DEFAULT 'paystack',
        reference       VARCHAR(100),
        type            VARCHAR(20) DEFAULT 'purchase'
                         CHECK (type IN ('purchase','bonus','refund','streak')),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('gem_transactions table OK');

    // 3. Indexes for payments
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gem_transactions_user ON gem_transactions(user_id)`);
    console.log('Indexes OK');

    console.log('\nImporting South African tribe data...\n');

    // 4. PSL Clubs (Betway Premiership 2024/25) — type 'club'
    const pslClubs = [
      { name: 'Mamelodi Sundowns', slug: 'mamelodi-sundowns', abbr: 'MSD', type: 'club', colors: ['#0C2340', '#FDB913'], nickname: 'The Brazilians', region: 'Pretoria' },
      { name: 'Orlando Pirates', slug: 'orlando-pirates', abbr: 'OP', type: 'club', colors: ['#000000', '#D11128'], nickname: 'The Buccaneers', region: 'Johannesburg' },
      { name: 'Kaizer Chiefs', slug: 'kaizer-chiefs', abbr: 'KC', type: 'club', colors: ['#FDB913', '#000000'], nickname: 'Amakhosi', region: 'Johannesburg' },
      { name: 'Stellenbosch FC', slug: 'stellenbosch-fc', abbr: 'SFC', type: 'club', colors: ['#003876', '#FFFFFF'], nickname: 'The Ikati', region: 'Stellenbosch' },
      { name: 'Sekhukhune United', slug: 'sekhukhune-united', abbr: 'SKU', type: 'club', colors: ['#00A825', '#FFD200'], nickname: 'Bambanani', region: 'Polokwane' },
      { name: 'TS Galaxy FC', slug: 'ts-galaxy', abbr: 'TSG', type: 'club', colors: ['#005EB8', '#FFD200'], nickname: 'The Shooters', region: 'Durban' },
      { name: 'Cape Town City', slug: 'cape-town-city', abbr: 'CTC', type: 'club', colors: ['#002366', '#FFFFFF'], nickname: 'The Citizens', region: 'Cape Town' },
      { name: 'SuperSport United', slug: 'supersport-united', abbr: 'SSU', type: 'club', colors: ['#0047AB', '#FFD200'], nickname: 'Matsatseng', region: 'Pretoria' },
      { name: 'AmaZulu FC', slug: 'amazulu-fc', abbr: 'AZU', type: 'club', colors: ['#00A825', '#FFFFFF'], nickname: 'Usuthu', region: 'Durban' },
      { name: 'Polokwane City', slug: 'polokwane-city', abbr: 'PC', type: 'club', colors: ['#00A825', '#FFD200'], nickname: 'The Urban Warriors', region: 'Polokwane' },
      { name: 'Golden Arrows', slug: 'golden-arrows', abbr: 'GA', type: 'club', colors: ['#003876', '#FFD200'], nickname: 'Abafana Besthende', region: 'Durban' },
      { name: 'Chippa United', slug: 'chippa-united', abbr: 'CU', type: 'club', colors: ['#F39C12', '#000000'], nickname: 'The Chilli Boys', region: 'Port Elizabeth' },
      { name: 'Royal AM', slug: 'royal-am', abbr: 'RAM', type: 'club', colors: ['#E31B23', '#FFD200'], nickname: 'The Royal', region: 'Johannesburg' },
      { name: 'Richards Bay FC', slug: 'richards-bay-fc', abbr: 'RB', type: 'club', colors: ['#002366', '#FFD200'], nickname: 'The Zizwe', region: 'Richards Bay' },
      { name: 'Marumo Gallants', slug: 'marumo-gallants', abbr: 'MG', type: 'club', colors: ['#00A825', '#C8102E'], nickname: 'The Bravanese', region: 'Polokwane' },
      { name: 'Magesi FC', slug: 'magesi-fc', abbr: 'MGI', type: 'club', colors: ['#002366', '#FFD200'], nickname: 'The Draw', region: 'Polokwane' },
    ];

    // 5. University Tribes — type 'university'
    const universities = [
      { name: 'University of Cape Town', slug: 'uct-ikey-tigers', abbr: 'UCT', type: 'university', colors: ['#003366', '#FDB913'], nickname: 'Ikey Tigers', region: 'Cape Town' },
      { name: 'University of the Witwatersrand', slug: 'wits-clever-boys', abbr: 'Wits', type: 'university', colors: ['#000000', '#FFD200'], nickname: 'Clever Boys', region: 'Johannesburg' },
      { name: 'University of Pretoria', slug: 'up-tuks', abbr: 'UP', type: 'university', colors: ['#00A825', '#FFFFFF'], nickname: 'Tuks', region: 'Pretoria' },
      { name: 'University of Johannesburg', slug: 'uj', abbr: 'UJ', type: 'university', colors: ['#002366', '#FFD200'], nickname: 'Johannesburg', region: 'Johannesburg' },
      { name: 'University of KwaZulu-Natal', slug: 'ukzn-impi', abbr: 'UKZN', type: 'university', colors: ['#003366', '#FFFFFF'], nickname: 'Impi', region: 'Durban' },
      { name: 'Stellenbosch University', slug: 'su-maties', abbr: 'SU', type: 'university', colors: ['#002366', '#FFFFFF'], nickname: 'Maties', region: 'Stellenbosch' },
      { name: 'North-West University', slug: 'nwu-eagles', abbr: 'NWU', type: 'university', colors: ['#002366', '#FFD200'], nickname: 'Eagles', region: 'Potchefstroom' },
      { name: 'University of the Western Cape', slug: 'uwc', abbr: 'UWC', type: 'university', colors: ['#FFD200', '#006400'], nickname: 'Cape Town', region: 'Cape Town' },
      { name: 'University of the Free State', slug: 'kovsies', abbr: 'UFS', type: 'university', colors: ['#002366', '#FFD200'], nickname: 'Kovsies', region: 'Bloemfontein' },
      { name: 'Rhodes University', slug: 'rhodes-university', abbr: 'Rhodes', type: 'university', colors: ['#003366', '#8B4513'], nickname: 'Grahamstown', region: 'Grahamstown' },
      { name: 'Nelson Mandela University', slug: 'nmbu-madibaz', abbr: 'NMU', type: 'university', colors: ['#003366', '#FFD200'], nickname: 'Madibaz', region: 'Port Elizabeth' },
    ];

    // Insert all SA tribes
    const allTribes = [...pslClubs, ...universities];
    let inserted = 0;

    for (const tribe of allTribes) {
      const result = await client.query(
        `INSERT INTO tribes (name, type, slug, primary_color, secondary_color)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           primary_color = EXCLUDED.primary_color,
           secondary_color = EXCLUDED.secondary_color
         RETURNING id`,
        [
          tribe.name,
          tribe.type,
          tribe.slug,
          tribe.colors[0] || '#333333',
          tribe.colors[1] || '#FFFFFF',
        ]
      );
      if (result.rowCount > 0) inserted++;
    }
    console.log(`Inserted/updated ${inserted} South African tribes`);

    // 6. Set up classic SA rivalries
    const rivalries = [
      { t1: 'orlando-pirates', t2: 'kaizer-chiefs', name: 'Soweto Derby' },
      { t1: 'cape-town-city', t2: 'stellenbosch-fc', name: 'Cape Derby' },
      { t1: 'uct-ikey-tigers', t2: 'su-maties', name: 'Varsity Cup Cape' },
      { t1: 'wits-clever-boys', t2: 'uj', name: 'Johannesburg Derby' },
      { t1: 'mamelodi-sundowns', t2: 'supersport-united', name: 'Pretoria Derby' },
      { t1: 'amazulu-fc', t2: 'golden-arrows', name: 'Durban Derby' },
    ];

    for (const rivalry of rivalries) {
      const r1 = await client.query('SELECT id FROM tribes WHERE slug = $1', [rivalry.t1]);
      const r2 = await client.query('SELECT id FROM tribes WHERE slug = $1', [rivalry.t2]);
      if (r1.rows[0] && r2.rows[0]) {
        await client.query(
          `UPDATE tribes SET rival_tribe_ids = array_append(rival_tribe_ids, $1) WHERE id = $2 AND NOT ($1 = ANY(rival_tribe_ids))`,
          [r2.rows[0].id, r1.rows[0].id]
        );
        await client.query(
          `UPDATE tribes SET rival_tribe_ids = array_append(rival_tribe_ids, $1) WHERE id = $2 AND NOT ($1 = ANY(rival_tribe_ids))`,
          [r1.rows[0].id, r2.rows[0].id]
        );
        console.log(`   Rivalry: ${rivalry.name}`);
      }
    }

    // Verify
    const { rows: counts } = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE type = 'club') as clubs,
        COUNT(*) FILTER (WHERE type = 'university') as universities,
        COUNT(*) FILTER (WHERE slug LIKE '%-%' AND type IN ('club','university')) as total
      FROM tribes
    `);
    console.log(`\nSA Tribes: ${counts[0].clubs} clubs, ${counts[0].universities} universities (${counts[0].total} total)`);

  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
