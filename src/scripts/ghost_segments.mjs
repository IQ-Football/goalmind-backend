/**
 * Ghost Segmentation Report Script (one-off / cron-able)
 *
 * Produces /home/team/shared/ghost-segments.json (read-only DB queries only).
 * The Growth Lead uses this to segment the 51k+ ghost users (no tribe) for
 * targeted outreach.
 *
 * Usage (from repo root):
 *   OUTPUT_PATH=/home/team/shared/ghost-segments.json node src/scripts/ghost_segments.mjs
 *
 * Requires DATABASE_URL in .env (same as the backend).
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { buildGhostSegments } from '../services/ghostSegmentationService.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 10000,
});

const outPath = process.env.OUTPUT_PATH || '/home/team/shared/ghost-segments.json';

try {
  const report = await buildGhostSegments(pool);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Ghost segmentation report written to ${outPath}`);
  console.log(`ghost_users=${report.totals.ghostUsers} total_users=${report.totals.totalUsers}`);
  console.log(`dataQuality.assessment: ${report.dataQuality.assessment}`);
} catch (err) {
  console.error('Failed to build ghost segmentation report:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
