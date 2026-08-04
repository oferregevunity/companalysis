/**
 * Seed the `xrayReports` collection (and the `xrayFacets/latest` leaderboards)
 * from a local JSON snapshot of AppBird X-Ray report rows, with no AppBird calls.
 *
 * Why this exists: X-Ray (`/v1/xray-reports`) has its own monthly request quota,
 * separate from `/v1/apps` and `/v1/developers`. When it is exhausted, `xray/run`
 * and the weekly job can't populate anything, and the /sdks page sits empty until
 * the quota resets — so a snapshot taken while quota was available can be loaded
 * directly. It is also handy for re-grouping: the facet rules are applied here, so
 * re-running rebuilds every row's facet fields without re-fetching.
 *
 * The snapshot may be either shape:
 *   - an array of raw X-Ray list rows (what `GET /v1/xray-reports` returns in
 *     `data`, concatenated across pages), or
 *   - `{ rows: [...] }` / `{ data: [...] }` wrapping the same.
 *
 * Existing `popularity` on a row is preserved (writes are merges).
 *
 * Run from the repo root (uses your gcloud application-default credentials, or
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key). If it fails
 * with a credentials error, run `gcloud auth application-default login` first:
 *
 *   NODE_PATH=functions/node_modules \
 *   npx tsx scripts/seed-xray-corpus.ts .local/xray-corpus-2026-08-04.json
 *
 * Safe to re-run: doc ids are derived from store + storeId, so it upserts.
 */
import { readFileSync } from 'fs';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { normalizeXraySummary, type XrayReportSummary } from '../functions/src/appbird/xrayClient';
import { upsertXrayReports } from '../functions/src/appbird/fetchXray';
import { buildFacets } from '../functions/src/appbird/xrayFacets';

/** From .firebaserc — passed explicitly so only credentials can be missing. */
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'supersonic-291210';

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore('companalysis');

function parseSnapshot(path: string): XrayReportSummary[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const raw: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.rows)
      ? parsed.rows
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];
  if (raw.length === 0) {
    throw new Error(`No report rows found in ${path} (expected an array, or { rows } / { data })`);
  }
  // Dedupe by reportId — a snapshot stitched from pages can repeat rows.
  const byId = new Map<string, XrayReportSummary>();
  let skipped = 0;
  for (const row of raw) {
    const report = normalizeXraySummary(row);
    if (!report) {
      skipped++;
      continue;
    }
    byId.set(report.reportId, report);
  }
  if (skipped > 0) console.warn(`Skipped ${skipped} row(s) without a reportId/storeId`);
  return [...byId.values()];
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npx tsx scripts/seed-xray-corpus.ts <snapshot.json>');
    process.exit(1);
  }

  const reports = parseSnapshot(path);
  const facets = buildFacets(reports);
  console.log(
    `Seeding ${reports.length} X-Ray reports ` +
      `(${facets.mediator.length} mediator / ${facets.publisherSdk.length} publisher-SDK / ${facets.engine.length} engine groups)…`,
  );

  const { written } = await upsertXrayReports(db, reports);
  console.log(`Wrote ${written} rows to xrayReports and rebuilt xrayFacets/latest.`);
  console.log('Top mediation groups:');
  for (const b of facets.mediator.slice(0, 5)) {
    console.log(`  ${String(b.count).padStart(5)}  ${String(b.sharePct + '%').padStart(6)}  ${b.label}`);
  }
  console.log(
    '\nPopularity (installs/ratings) is not part of the snapshot: it comes from /v1/apps, ' +
      'which has its own quota. The weekly job back-fills it, or use the page\'s "Rank N more" button.',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    // `invalid_rapt` / `invalid_grant` mean ADC exists but its token expired and
    // needs re-authentication — the same fix as having no credentials at all.
    if (
      /could not load the default credentials|Unable to detect a Project Id|UNAUTHENTICATED|invalid_grant|invalid_rapt|reauth/i.test(
        message,
      )
    ) {
      console.error(
        `Firestore rejected the connection: ${message}\n\n` +
          'This script writes with the Admin SDK, which needs current Google credentials —\n' +
          'being logged into the Firebase CLI is not enough, and an expired ADC token fails\n' +
          'the same way. Run:\n\n' +
          '  gcloud auth application-default login\n\n' +
          'then re-run this script. (Or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key.)',
      );
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
