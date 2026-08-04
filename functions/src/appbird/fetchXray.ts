import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { getAppDetails } from './fetchApp';
import { getAllXrayReports, getXrayReport, type XrayReport, type XrayReportSummary } from './xrayClient';
import { buildFacets, reportFacets, type XrayReportFacets } from './xrayFacets';

/**
 * Builds the read model behind the /sdks page:
 * - `xrayReports` — one doc per AppBird X-Ray teardown, with normalized facet
 *   keys and (once enriched) store popularity. Clients read this directly.
 * - `xrayFacets/latest` — precomputed mediator / publisher-SDK / engine
 *   leaderboards for the facet rail.
 * - `xrayTeardowns` — full teardown bodies, fetched on demand and cached.
 *
 * X-Ray carries no popularity metric, so "top games" ranking comes from
 * `/v1/apps/{storeId}` (installs on Play, rating count on both stores) via the
 * 24h-cached `getAppDetails`. That is one AppBird request per app, so enrichment
 * is budgeted per run and resumes on the next one — the corpus warms over a few
 * weekly runs and stays warm from then on.
 */

const REPORTS_COLLECTION = 'xrayReports';
const TEARDOWNS_COLLECTION = 'xrayTeardowns';
const FACETS_COLLECTION = 'xrayFacets';

/** Re-enrich popularity after this long. Store listings move slowly. */
const POPULARITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Leave headroom under the 540s function timeout. */
const DEFAULT_TIME_BUDGET_MS = 7 * 60 * 1000;

/** Popularity is comparable across stores via rating count; installs are Play-only. */
export interface XrayPopularity {
  iconUrl: string | null;
  /** Play install count. 0 on the App Store, which does not publish installs. */
  installs: number;
  /** Rating count — the only popularity signal both stores expose. */
  numberVoters: number;
  rating: number;
  /** Best current top-100 category rank, when the app charts at all. */
  bestRank: number | null;
  comingSoon: boolean | null;
  fetchedAt: string;
}

export function xrayDocId(store: string, storeId: string): string {
  return createHash('sha1').update(`${store}:${storeId}`).digest('hex').slice(0, 24);
}

/** The stored shape of one report doc (summary + facets + optional popularity). */
export interface XrayReportDoc extends XrayReportSummary, XrayReportFacets {
  popularity: XrayPopularity | null;
}

/**
 * Summary + facet fields only. `popularity` is deliberately absent: these writes
 * are merges, and an omitted field keeps whatever a previous enrichment pass
 * stored (writing `null` would clobber it).
 */
function toDoc(report: XrayReportSummary): Omit<XrayReportDoc, 'popularity'> {
  return { ...report, ...reportFacets(report) };
}

/**
 * Upsert report rows and recompute the facet leaderboards. Facet fields are
 * rewritten every time so grouping changes roll out with a re-run; existing
 * `popularity` survives (merge write), since it comes from a different and more
 * expensive endpoint.
 *
 * Split from the crawl so a local snapshot can be seeded without AppBird calls —
 * X-Ray has its own monthly request quota, and when it is exhausted this is the
 * only way to (re)populate. See `scripts/seed-xray-corpus.ts`.
 */
export async function upsertXrayReports(
  db: Firestore,
  reports: XrayReportSummary[],
): Promise<{ written: number }> {
  const col = db.collection(REPORTS_COLLECTION);
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < reports.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const r of reports.slice(i, i + BATCH_SIZE)) {
      batch.set(
        col.doc(xrayDocId(r.store, r.storeId)),
        {
          ...toDoc(r),
          teardownDateTs: r.teardownDate ? admin.firestore.Timestamp.fromDate(new Date(r.teardownDate)) : null,
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      written++;
    }
    await batch.commit();
  }

  await writeFacets(db, reports);
  return { written };
}

/** Crawl every X-Ray report from AppBird, then upsert. */
export async function syncXrayReports(
  db: Firestore,
  apiKey: string,
): Promise<{ total: number; pages: number; written: number }> {
  const { reports, total, pages } = await getAllXrayReports(apiKey);
  const { written } = await upsertXrayReports(db, reports);
  console.log(`xrayReports: ${total} reported, ${reports.length} fetched in ${pages} pages, ${written} written`);
  return { total, pages, written };
}

/** Recompute and store the facet leaderboards. */
async function writeFacets(db: Firestore, reports: XrayReportSummary[]): Promise<void> {
  const facets = buildFacets(reports);
  await db.collection(FACETS_COLLECTION).doc('latest').set({
    ...facets,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Fill in store popularity for specific apps (or the stalest ones when no ids are
 * given). Serves cached listings where possible; each miss is one AppBird call.
 * Stops at `timeBudgetMs` and leaves the rest for the next run.
 */
export async function enrichXrayPopularity(
  db: Firestore,
  apiKey: string,
  opts: { storeIds?: string[]; limit?: number; timeBudgetMs?: number; force?: boolean } = {},
): Promise<{ enriched: number; skipped: number; errors: string[]; remaining: number }> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const col = db.collection(REPORTS_COLLECTION);

  let docs: admin.firestore.QueryDocumentSnapshot[];
  if (opts.storeIds?.length) {
    // Chunked `in` queries — Firestore caps `in` at 30 values.
    const chunks: string[][] = [];
    for (let i = 0; i < opts.storeIds.length; i += 30) chunks.push(opts.storeIds.slice(i, i + 30));
    const results = await Promise.all(chunks.map((c) => col.where('storeId', 'in', c).get()));
    docs = results.flatMap((snap) => snap.docs);
  } else {
    const snap = await col.orderBy('teardownDateTs', 'desc').limit(opts.limit ?? 250).get();
    docs = snap.docs;
  }

  const errors: string[] = [];
  let enriched = 0;
  let skipped = 0;
  let remaining = 0;

  for (const doc of docs) {
    const data = doc.data() as XrayReportDoc;
    const pop = data.popularity;
    const fresh =
      !opts.force && pop?.fetchedAt && Date.now() - new Date(pop.fetchedAt).getTime() < POPULARITY_TTL_MS;
    if (fresh) {
      skipped++;
      continue;
    }
    if (Date.now() - started > budget) {
      remaining++;
      continue;
    }

    try {
      const { app } = await getAppDetails(db, data.storeId, apiKey);
      const ranks = app.categoryRankings.map((r) => r.rank).filter((r) => Number.isFinite(r));
      const popularity: XrayPopularity = {
        iconUrl: app.iconUrl,
        installs: app.installs,
        numberVoters: app.numberVoters,
        rating: app.rating,
        bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
        comingSoon: app.comingSoon,
        fetchedAt: new Date().toISOString(),
      };
      await doc.ref.set({ popularity }, { merge: true });
      enriched++;
    } catch (err) {
      errors.push(`${data.appName} (${data.store} ${data.storeId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `xray popularity: ${enriched} enriched, ${skipped} still fresh, ${remaining} left for next run, ${errors.length} errors`,
  );
  return { enriched, skipped, errors, remaining };
}

/** Full crawl + a budgeted enrichment pass. Used by the weekly job and `xray/run`. */
export async function runXraySync(
  db: Firestore,
  apiKey: string,
  opts: { enrichLimit?: number; timeBudgetMs?: number } = {},
): Promise<{
  total: number;
  pages: number;
  written: number;
  enriched: number;
  skipped: number;
  remaining: number;
  errors: string[];
}> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const sync = await syncXrayReports(db, apiKey);

  // `enrichLimit: 0` means crawl only — useful for a fast first population, and
  // it also keeps a 0 from reaching Firestore's limit(), which rejects it.
  if (opts.enrichLimit === 0) {
    return { ...sync, enriched: 0, skipped: 0, remaining: 0, errors: [] };
  }

  const popularity = await enrichXrayPopularity(db, apiKey, {
    limit: opts.enrichLimit ?? 250,
    timeBudgetMs: Math.max(budget - (Date.now() - started), 5000),
  });
  return { ...sync, ...popularity };
}

/**
 * One app's full teardown, cached in `xrayTeardowns`. Teardowns are immutable for
 * a given report, so a cache hit only re-fetches when the report id changed.
 */
export async function getXrayTeardown(
  db: Firestore,
  storeId: string,
  apiKey: string,
  opts: { store?: string; expectedReportId?: string; refresh?: boolean } = {},
): Promise<{ report: XrayReport; fromCache: boolean }> {
  const ref = db.collection(TEARDOWNS_COLLECTION).doc(xrayDocId(opts.store ?? 'AppStore', storeId));

  if (!opts.refresh) {
    try {
      const snap = await ref.get();
      const cached = snap.data()?.report as XrayReport | undefined;
      if (cached && (!opts.expectedReportId || cached.reportId === opts.expectedReportId)) {
        return { report: cached, fromCache: true };
      }
    } catch (err) {
      console.warn(`xrayTeardowns cache read failed for ${storeId}:`, err);
    }
  }

  const report = await getXrayReport(storeId, apiKey);
  try {
    await ref.set({
      storeId,
      store: report.store,
      report,
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn(`xrayTeardowns cache write failed for ${storeId}:`, err);
  }
  return { report, fromCache: false };
}
