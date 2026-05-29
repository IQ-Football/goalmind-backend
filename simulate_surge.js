import { Client } from "pg";

const connectionString = "postgresql://postgres:postgres@localhost:5432/goalmind";

async function simulateSurge() {
  const client = new Client({ connectionString });
  await client.connect();

  const tribes = [
    { slug: "enyimba-fc", count: 49 },
    { slug: "kaizer-chiefs", count: 24 },
    { slug: "yanga-sc", count: 24 },
    { slug: "simba-sc", count: 19 },
    { slug: "orlando-pirates", count: 5 }
  ];

  for (const tribe of tribes) {
    const tribeRes = await client.query("SELECT id FROM tribes WHERE slug = $1", [tribe.slug]);
    if (tribeRes.rows.length === 0) {
      console.error(`Tribe not found: ${tribe.slug}`);
      continue;
    }
    const tribeId = tribeRes.rows[0].id;

    for (let i = 0; i < tribe.count; i++) {
      const email = `${tribe.slug}_surge_${i}@goalmind.test`;
      const username = `${tribe.slug}_User_${i}`;

      // Onboarding directly to users
      await client.query(`
        INSERT INTO users (username, email, tribe_id, referral_code)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO NOTHING
      `, [username, email, tribeId, `GM_${tribe.slug.substring(0, 4).toUpperCase()}_${i}`]);
    }
    console.log(`Simulated ${tribe.count} signups for ${tribe.slug}`);
  }

  const res = await client.query("SELECT COUNT(*) FROM users");
  console.log(`NEW_TOTAL_SIGNUPS=${res.rows[0].count}`);

  await client.end();
}

simulateSurge().catch(console.error);
