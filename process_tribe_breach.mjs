import pg from 'pg';
const { Client } = pg;

const connectionString = "postgresql://postgres:postgres@localhost:5432/goalmind";

async function processTribeBreach(tribeSlug) {
  const client = new Client({ connectionString });
  await client.connect();

  console.log(`--- IMPERIAL BREACH PROCESSING: ${tribeSlug.toUpperCase()} ---`);

  const TRIBE_COMMANDER_ID = '550e8400-e29b-41d4-a716-446655440005';
  const FOUNDING_CENTURION_ID = '660e8400-e29b-41d4-a716-446655440001';
  const FOUNDING_GENERAL_ID = '550e8400-e29b-41d4-a716-446655440000';

  // 1. Get Tribe Info
  const tribeRes = await client.query('SELECT id, name, member_count, is_super_tribe FROM tribes WHERE slug = $1', [tribeSlug]);
  const tribe = tribeRes.rows[0];

  if (!tribe) {
    console.error(`Tribe ${tribeSlug} not found!`);
    await client.end();
    return;
  }

  const currentCount = parseInt(tribe.member_count);
  console.log(`Current member count: ${currentCount}`);

  if (currentCount >= 1000) {
    console.log("MILESTONE REACHED: 1,000 Members!");

    if (tribe.is_super_tribe) {
      console.log("Tribe already has Imperial status.");
    } else {
      // 2. Set Imperial Status
      await client.query('UPDATE tribes SET is_super_tribe = true WHERE id = $1', [tribe.id]);
      console.log("Tribe status updated to IMPERIAL (is_super_tribe = true).");
    }

    // 3. Award Tribe Commander to Captain (First member)
    const captainRes = await client.query('SELECT id, username FROM users WHERE tribe_id = $1 ORDER BY created_at ASC LIMIT 1', [tribe.id]);
    const captain = captainRes.rows[0];
    if (captain) {
      await client.query(`
        INSERT INTO user_achievements (user_id, achievement_id, earned_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, achievement_id) DO NOTHING
      `, [captain.id, TRIBE_COMMANDER_ID]);
      console.log(`AWARDED: Tribe Commander to ${captain.username}`);
    }

    // 4. Award Founding General to Top 10 Recruiters
    const generalsRes = await client.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT referrer_id, $1, NOW() FROM referrals
      WHERE tribe_id = $2
      GROUP BY referrer_id
      ORDER BY COUNT(*) DESC
      LIMIT 10
      ON CONFLICT (user_id, achievement_id) DO NOTHING
      RETURNING *
    `, [FOUNDING_GENERAL_ID, tribe.id]);
    console.log(`AWARDED: Founding General Badge to top ${generalsRes.rowCount} recruiters.`);

    // 5. Award Founding Centurion to the first 1,000 members
    const eligibleRes = await client.query(`
      INSERT INTO user_achievements (user_id, achievement_id, earned_at)
      SELECT id, $1, created_at FROM users
      WHERE tribe_id = $2
      ORDER BY created_at ASC
      LIMIT 1000
      ON CONFLICT (user_id, achievement_id) DO NOTHING
      RETURNING *
    `, [FOUNDING_CENTURION_ID, tribe.id]);
    
    console.log(`AWARDED: Founding Centurion Badge to ${eligibleRes.rowCount} users.`);

    // 6. System Event
    await client.query(`
      INSERT INTO system_events (event_type, metadata, created_at)
      VALUES ($1, $2, NOW())
    `, ['IMPERIAL_BREACH', JSON.stringify({ tribe: tribe.name, slug: tribeSlug, count: currentCount, commander: captain?.username })]);

  } else {
    console.log(`${tribe.name} still needs ${1000 - currentCount} more members for Imperial status.`);
  }

  console.log("--- PROCESSING COMPLETE ---");
  await client.end();
}

const slug = process.argv[2];
if (!slug) {
  console.error("Please provide a tribe slug as an argument.");
  process.exit(1);
}

processTribeBreach(slug).catch(console.error);
