/**
 * Ghost Segmentation Service
 * Targets users who signed up but never picked a tribe (tribe_id IS NULL).
 *
 * Used by:
 *  - GET /admin/ghosts/segments  (live endpoint, admin-only)
 *  - src/scripts/ghost_segments.mjs (one-off report -> /home/team/shared/ghost-segments.json)
 *
 * All queries are read-only. The `db` argument is any object exposing
 * `db.query(sql, params)` (fastify.db or a pg Pool both work).
 */

// Cohort -> region -> tribe mapping. Mirrors the geo-suggestion logic in
// onboardingService.js (GEO_IP_MAPPING) so the "best suggested tribe" per
// segment matches what the app itself would suggest for that market.
const COHORT_TO_SEGMENT = {
  centurion_surge_north: {
    region: 'North Africa (Egypt/Tunisia/Libya)',
    countries: ['Egypt', 'Tunisia', 'Libya'],
    tribeSlug: 'al-ahly',
    backupSlug: 'zamalek',
  },
  centurion_surge_ng: {
    region: 'Nigeria',
    countries: ['Nigeria'],
    // NOTE: onboardingService.GEO_IP_MAPPING uses slug 'enyimba-fc', but the
    // tribes table stores 'enyimba' — the app's suggestTribe therefore falls
    // back to 'nigeria' for Nigeria. We use the real DB slug here.
    tribeSlug: 'enyimba',
    backupSlug: 'nigeria',
  },
  centurion_surge_sa: {
    region: 'South Africa',
    countries: ['South Africa'],
    tribeSlug: 'kaizer-chiefs',
    backupSlug: 'orlando-pirates',
  },
};

async function resolveTribe(db, slug) {
  if (!slug) return null;
  const res = await db.query(
    'SELECT id, name, slug, member_count FROM tribes WHERE slug = $1',
    [slug]
  );
  return res.rows[0] || null;
}

async function topTribe(db) {
  const res = await db.query(
    'SELECT id, name, slug, member_count FROM tribes ORDER BY member_count DESC LIMIT 1'
  );
  return res.rows[0] || null;
}

export async function buildGhostSegments(db) {
  // --- Totals ---
  const totals = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM users) AS total_users,
       (SELECT COUNT(*)::int FROM users WHERE tribe_id IS NULL) AS ghost_users,
       (SELECT COUNT(*)::int FROM users WHERE tribe_id IS NOT NULL) AS with_tribe`
  );
  const t = totals.rows[0];

  // --- By signup date (recent first) ---
  const bySignup = await db.query(
    `SELECT date_trunc('day', created_at)::date AS signup_date, COUNT(*)::int AS n
     FROM users WHERE tribe_id IS NULL
     GROUP BY signup_date ORDER BY signup_date DESC`
  );

  // --- By cohort (the only region signal stored for ghost users) ---
  const byCohort = await db.query(
    `SELECT cohort, COUNT(*)::int AS n
     FROM users WHERE tribe_id IS NULL
     GROUP BY cohort ORDER BY n DESC`
  );

  // --- By last-active bucket ---
  const byLastActive = await db.query(
    `SELECT CASE
       WHEN last_active_at >= NOW() - INTERVAL '7 days' THEN 'last_7d'
       WHEN last_active_at >= NOW() - INTERVAL '30 days' THEN 'last_30d'
       WHEN last_active_at >= NOW() - INTERVAL '90 days' THEN 'last_90d'
       WHEN last_active_at IS NOT NULL THEN 'older'
       ELSE 'never'
     END AS bucket, COUNT(*)::int AS n
     FROM users WHERE tribe_id IS NULL
     GROUP BY bucket ORDER BY n DESC`
  );

  // --- By status ---
  const byStatus = await db.query(
    `SELECT status, COUNT(*)::int AS n FROM users WHERE tribe_id IS NULL GROUP BY status ORDER BY n DESC`
  );

  // --- Reachability ---
  const reach = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE phone_number IS NOT NULL AND phone_number <> '')::int AS with_phone,
       COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int AS with_email
     FROM users WHERE tribe_id IS NULL`
  );
  const emailDomains = await db.query(
    `SELECT lower(split_part(email, '@', 2)) AS domain, COUNT(*)::int AS n
     FROM users WHERE tribe_id IS NULL AND email IS NOT NULL
     GROUP BY domain ORDER BY n DESC LIMIT 10`
  );

  // --- Signup window (bulk-import detection) ---
  const windowQ = await db.query(
    `SELECT MIN(created_at) AS min_created, MAX(created_at) AS max_created,
            COUNT(DISTINCT date_trunc('day', created_at))::int AS distinct_days
     FROM users WHERE tribe_id IS NULL`
  );
  const w = windowQ.rows[0];

  // --- Per-cohort segments with suggested tribe (reuses geo suggestion logic) ---
  const segments = [];
  for (const row of byCohort.rows) {
    const cfg = COHORT_TO_SEGMENT[row.cohort] || null;
    let suggestedTribe = null;
    let backupTribe = null;
    if (cfg) {
      suggestedTribe = await resolveTribe(db, cfg.tribeSlug);
      backupTribe = await resolveTribe(db, cfg.backupSlug);
    } else if (row.cohort === 'centurion_surge_gen') {
      // Global cohort, no geo signal -> suggest the most popular tribe
      suggestedTribe = await topTribe(db);
    }
    segments.push({
      cohort: row.cohort,
      count: row.n,
      region: cfg ? cfg.region : (row.cohort === 'centurion_surge_gen' ? 'Global (no geo signal)' : 'Unknown'),
      countries: cfg ? cfg.countries : [],
      suggestedTribe: suggestedTribe ? { id: suggestedTribe.id, name: suggestedTribe.name, slug: suggestedTribe.slug } : null,
      backupTribe: backupTribe ? { id: backupTribe.id, name: backupTribe.name, slug: backupTribe.slug } : null,
      reachablePhones: 0,
      reachableEmails: 0,
    });
  }

  // Data-quality assessment (critical context for the Growth Lead)
  const syntheticDomainCount = emailDomains.rows
    .filter(d => d.domain === 'goalmind.app' || d.domain === 'example.com')
    .reduce((acc, d) => acc + d.n, 0);
  const isBulkImport = w.distinct_days === 1 && reach.rows[0].with_phone === 0 &&
    (syntheticDomainCount / Math.max(reach.rows[0].total, 1)) > 0.99;

  return {
    generatedAt: new Date().toISOString(),
    definition: 'ghost = user with tribe_id IS NULL (signed up, never picked a tribe)',
    totals: {
      totalUsers: t.total_users,
      ghostUsers: t.ghost_users,
      withTribe: t.with_tribe,
    },
    dataQuality: {
      reachablePhones: reach.rows[0].with_phone,
      reachableEmails: reach.rows[0].with_email,
      emailDomains: emailDomains.rows,
      signupWindow: {
        minCreated: w.min_created,
        maxCreated: w.max_created,
        distinctDays: w.distinct_days,
        bulkImportLikely: isBulkImport,
      },
      assessment: isBulkImport
        ? 'All ghost users were bulk-imported in a single window (seed/test accounts: legacy_user*@goalmind.app, user*@example.com, vanguard_* usernames). They have NO phone numbers and NO real emails, so they are NOT reachable for outreach campaigns.'
        : 'Ghost users appear to be individual signups.',
    },
    segments: {
      bySignupDate: bySignup.rows,
      byCohort: byCohort.rows,
      byRegion: segments,
      byLastActive: byLastActive.rows,
      byStatus: byStatus.rows,
    },
    recommendedOutreach: segments.map(s => ({
      segment: s.cohort,
      region: s.region,
      count: s.count,
      suggestedTribeSlug: s.suggestedTribe ? s.suggestedTribe.slug : null,
      suggestedTribeName: s.suggestedTribe ? s.suggestedTribe.name : null,
      backupTribeSlug: s.backupTribe ? s.backupTribe.slug : null,
      reachablePhones: s.reachablePhones,
      reachableEmails: s.reachableEmails,
      note: reach.rows[0].with_phone === 0
        ? 'No reachable phone numbers — cannot be contacted via SMS/WhatsApp campaign.'
        : 'See reachablePhones for contact capacity.',
    })),
  };
}
