import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { getAppDetails } from './fetchApp';
import { AppbirdQuotaError } from './http';
import { CallMeter, checkBudget, XRAY_ENDPOINT_CREDITS, type BudgetStatus } from './usage';
import {
  getAllXrayReports,
  getXrayIntegrations,
  getXrayReport,
  getXrayReports,
  XRAY_MAX_LIMIT,
  type XrayIntegration,
  type XrayReport,
  type XrayReportSummary,
} from './xrayClient';
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

/**
 * Re-enrich popularity after this long. Install counts and rating totals move
 * slowly, and this must stay comfortably ABOVE the interval between sweeps of the
 * corpus — otherwise every run finds its slice at the TTL boundary and re-fetches
 * apps it already knows, spending the whole budget without ever reaching the rest
 * (the bug that drained the August quota).
 */
const POPULARITY_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * A cached listing this old is still fine for ranking, so enrichment reuses it
 * rather than spending a call. Much longer than the 24h interactive default.
 */
const POPULARITY_MAX_CACHE_AGE_MS = 45 * 24 * 60 * 60 * 1000;

/** Full re-crawl at most this often; in between, only new teardowns are fetched. */
const FULL_CRAWL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Overlap re-fetched on an incremental crawl. `teardownDateFrom` has day
 * granularity, so re-reading the last synced day guarantees nothing is missed
 * when several teardowns land on the same date.
 */
const INCREMENTAL_OVERLAP_DAYS = 2;

/** Leave headroom under the 540s function timeout. */
const DEFAULT_TIME_BUDGET_MS = 7 * 60 * 1000;

/** Sync bookkeeping: `xrayFacets/syncState`. */
const SYNC_STATE_DOC = 'syncState';

/** Cached integration vocabulary: `xrayFacets/integrations`. */
const INTEGRATIONS_DOC = 'integrations';

/**
 * The integration list is a slow-moving reference vocabulary (new SDKs appear, they
 * don't churn), so a week-old copy is fine and costs nothing to serve.
 */
const INTEGRATIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface XraySyncState {
  /** Newest `teardownDate` seen, YYYY-MM-DD. */
  lastTeardownDate: string | null;
  /** When the last *full* crawl ran. */
  lastFullCrawlAt: admin.firestore.Timestamp | null;
  /** Where the rotating popularity sweep stopped, as a doc id. */
  popularityCursor: string | null;
}

/** Shift a YYYY-MM-DD date back by `days`, staying in that format. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Decide what the next crawl should fetch. A full crawl costs ~24 calls; an
 * incremental one usually costs 1, because a couple of days of new teardowns fit
 * in a single 50-row page.
 */
export function planCrawl(
  state: Pick<XraySyncState, 'lastTeardownDate' | 'lastFullCrawlAt'>,
  opts: { force?: boolean; now?: Date } = {},
): { full: boolean; teardownDateFrom?: string; reason: string } {
  const now = opts.now ?? new Date();
  if (opts.force) return { full: true, reason: 'full crawl requested' };
  if (!state.lastTeardownDate) return { full: true, reason: 'no previous sync' };

  const lastFull = state.lastFullCrawlAt ? state.lastFullCrawlAt.toMillis() : 0;
  if (now.getTime() - lastFull > FULL_CRAWL_INTERVAL_MS) {
    return { full: true, reason: 'periodic full crawl (catches edited or backfilled reports)' };
  }
  return {
    full: false,
    teardownDateFrom: shiftDate(state.lastTeardownDate, INCREMENTAL_OVERLAP_DAYS),
    reason: `incremental from ${shiftDate(state.lastTeardownDate, INCREMENTAL_OVERLAP_DAYS)}`,
  };
}

/** Per-integration app membership: `xrayIntegrationApps/{hash}`. */
const INTEGRATION_APPS_COLLECTION = 'xrayIntegrationApps';

/**
 * Backstop re-resolve interval. Corpus growth is detected exactly (see
 * `planIntegrationRefresh`), so this only exists to catch what growth detection
 * cannot: a teardown *edited* in place, or an app that DROPPED the integration —
 * a removal is invisible to an incremental union, so membership has to be rebuilt
 * from scratch occasionally.
 */
const INTEGRATION_APPS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pages a first resolve will spend without being asked twice. Each page is one
 * billed request for 50 apps, so this is the real cost dial.
 *
 * Deliberately low: a broad SDK (an analytics or crash library present in most of
 * the corpus) would otherwise page through the entire ~1200-app corpus on one
 * click. A membership that broad also carries little signal — "most games ship it"
 * — so the default is to return the first pages plus the true `total` and let the
 * caller opt into completing it via `fetchAll`.
 */
const INTEGRATION_AUTO_PAGES = 3;

/** Hard runaway guard: enough for the whole corpus. Only reachable with `fetchAll`. */
const INTEGRATION_MAX_PAGES = 24;

/** One member app. Enough to join against `xrayReports`, which is keyed on both. */
export interface XrayIntegrationApp {
  store: string;
  storeId: string;
}

/** The cached membership, as stored. */
interface XrayIntegrationAppsCache {
  integration: string;
  apps: XrayIntegrationApp[];
  total: number;
  partial: boolean;
  fetchedAt: string;
  /**
   * `syncState.lastTeardownDate` when this membership was built. Growth past this
   * date is what makes the entry stale, and doubles as the `teardownDateFrom` for
   * an incremental top-up.
   */
  corpusTeardownDate: string | null;
}

export type XrayIntegrationRefreshAction = 'serve' | 'incremental' | 'full';

/**
 * Decide how to answer a membership request. Pure so the cost policy is testable
 * without touching Firestore or AppBird.
 *
 * The point is that a stale entry rarely needs a full re-resolve. Membership only
 * gains apps when new teardowns land, so when the corpus has merely advanced, the
 * new members can be fetched with the same `integration` filter plus
 * `teardownDateFrom` — usually a single page — and unioned into what is already
 * cached. Full rebuilds are reserved for the cases a union cannot express.
 */
export function planIntegrationRefresh(
  cached: Pick<XrayIntegrationAppsCache, 'fetchedAt' | 'partial' | 'corpusTeardownDate'> | null,
  corpusTeardownDate: string | null,
  opts: { refresh?: boolean; fetchAll?: boolean; now?: Date } = {},
): { action: XrayIntegrationRefreshAction; reason: string; teardownDateFrom?: string } {
  const now = opts.now ?? new Date();
  if (!cached) return { action: 'full', reason: 'no cached membership' };
  if (opts.refresh) return { action: 'full', reason: 'refresh requested' };

  // A partial entry is only completed when the caller explicitly asks; otherwise it
  // is served as-is, since re-resolving would spend the pages the cap just avoided.
  if (cached.partial && opts.fetchAll) return { action: 'full', reason: 'completing a partial membership' };

  const age = now.getTime() - new Date(cached.fetchedAt).getTime();
  if (!Number.isFinite(age) || age >= INTEGRATION_APPS_TTL_MS) {
    return { action: 'full', reason: `cached ${Math.round(age / 86400000)}d ago, past the re-resolve interval` };
  }

  // Corpus advanced: top up with only the teardowns added since, then union.
  if (corpusTeardownDate && corpusTeardownDate !== cached.corpusTeardownDate) {
    const from = cached.corpusTeardownDate
      ? shiftDate(cached.corpusTeardownDate, INCREMENTAL_OVERLAP_DAYS)
      : undefined;
    // Without a stamped date there is no safe lower bound, so rebuild instead.
    if (!from) return { action: 'full', reason: 'cached before corpus dates were tracked' };
    return {
      action: 'incremental',
      reason: `corpus advanced to ${corpusTeardownDate}, topping up from ${from}`,
      teardownDateFrom: from,
    };
  }

  return { action: 'serve', reason: 'cached membership is current' };
}

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
  opts: {
    /**
     * Rows to compute the facet leaderboards from. Pass the full corpus when you
     * have it; pass `'firestore'` after a partial write to rebuild from every
     * stored row (Firestore reads, no AppBird quota).
     *
     * `'skip'` leaves the stored leaderboards untouched — for interactive writes of
     * a narrow slice, where a rebuild would either clobber the global leaderboards
     * (if computed from the slice) or read the whole collection on every click.
     * The weekly full crawl reconciles them.
     */
    rebuildFacetsFrom?: XrayReportSummary[] | 'firestore' | 'skip';
  } = {},
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

  const source = opts.rebuildFacetsFrom ?? reports;
  if (source !== 'skip') {
    await writeFacets(db, source === 'firestore' ? await readAllStoredReports(db) : source);
  }
  return { written };
}

/**
 * Of the fetched reports, the ones Firestore doesn't already hold at the same
 * `reportId` — i.e. genuinely new teardowns or replacements of an older one.
 * Uses a single `getAll`, so it costs reads rather than AppBird quota.
 */
async function selectChangedReports(
  db: Firestore,
  reports: XrayReportSummary[],
): Promise<XrayReportSummary[]> {
  if (reports.length === 0) return [];
  const col = db.collection(REPORTS_COLLECTION);
  const refs = reports.map((r) => col.doc(xrayDocId(r.store, r.storeId)));
  try {
    const snaps = await db.getAll(...refs);
    const storedReportId = new Map<string, string | undefined>();
    snaps.forEach((snap, i) => storedReportId.set(refs[i].id, snap.data()?.reportId as string | undefined));
    return reports.filter((r) => storedReportId.get(xrayDocId(r.store, r.storeId)) !== r.reportId);
  } catch (err) {
    // If the comparison fails, fall back to writing everything fetched — correct,
    // just less efficient.
    console.warn('xray change detection failed, upserting all fetched rows:', err);
    return reports;
  }
}

/** Every stored report row, for rebuilding facets without re-fetching from AppBird. */
async function readAllStoredReports(db: Firestore): Promise<XrayReportSummary[]> {
  const snap = await db.collection(REPORTS_COLLECTION).get();
  return snap.docs.map((d) => d.data() as XrayReportSummary);
}

async function readSyncState(db: Firestore): Promise<XraySyncState> {
  try {
    const snap = await db.collection(FACETS_COLLECTION).doc(SYNC_STATE_DOC).get();
    const data = snap.data() ?? {};
    return {
      lastTeardownDate: typeof data.lastTeardownDate === 'string' ? data.lastTeardownDate : null,
      lastFullCrawlAt: data.lastFullCrawlAt ?? null,
      popularityCursor: typeof data.popularityCursor === 'string' ? data.popularityCursor : null,
    };
  } catch (err) {
    console.warn('xray syncState read failed, treating as first run:', err);
    return { lastTeardownDate: null, lastFullCrawlAt: null, popularityCursor: null };
  }
}

/**
 * Crawl X-Ray reports and upsert them. Incremental by default: only teardowns
 * newer than the last sync are fetched (~1 call), with a periodic full crawl to
 * pick up reports that were edited rather than added.
 *
 * A full crawl also rebuilds the facet leaderboards from the whole corpus. An
 * incremental one can't — it only holds the new slice — so facets are rebuilt
 * from Firestore instead, which costs reads but no AppBird quota.
 */
export async function syncXrayReports(
  db: Firestore,
  apiKey: string,
  opts: { fullCrawl?: boolean; maxPages?: number; onAttempt?: (endpoint: string) => void } = {},
): Promise<{ total: number; pages: number; written: number; full: boolean; reason: string }> {
  const state = await readSyncState(db);
  const plan = planCrawl(state, { force: opts.fullCrawl });

  const { reports, total, pages } = await getAllXrayReports(apiKey, {
    teardownDateFrom: plan.teardownDateFrom,
    maxPages: opts.maxPages,
    onAttempt: opts.onAttempt,
  });

  /**
   * An incremental crawl deliberately re-reads the last couple of days, so most of
   * what comes back is usually already stored. Check before doing any work: if no
   * report is new or replaced, skip the writes and the facet rebuild (which reads
   * the whole collection) entirely. The crawl page is its own probe, so this costs
   * no extra AppBird call.
   */
  const changed = plan.full ? reports : await selectChangedReports(db, reports);
  if (changed.length === 0) {
    const reason = `${plan.reason} — nothing new (${reports.length} already current)`;
    console.log(`xrayReports: ${reason}`);
    await db
      .collection(FACETS_COLLECTION)
      .doc(SYNC_STATE_DOC)
      .set({ lastSyncAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { total, pages, written: 0, full: plan.full, reason };
  }

  const { written } = await upsertXrayReports(db, changed, {
    rebuildFacetsFrom: plan.full ? reports : 'firestore',
  });

  const newestTeardown = reports
    .map((r) => r.teardownDate)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

  await db
    .collection(FACETS_COLLECTION)
    .doc(SYNC_STATE_DOC)
    .set(
      {
        lastTeardownDate: newestTeardown ?? state.lastTeardownDate ?? null,
        ...(plan.full ? { lastFullCrawlAt: admin.firestore.Timestamp.now() } : {}),
        lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  console.log(
    `xrayReports: ${plan.reason} — ${reports.length} fetched in ${pages} page(s), ${written} written (${total} match the query)`,
  );
  return { total, pages, written, full: plan.full, reason: plan.reason };
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
  opts: {
    storeIds?: string[];
    limit?: number;
    timeBudgetMs?: number;
    force?: boolean;
    /** Hard ceiling on AppBird calls this pass may make. */
    callBudget?: number;
    onAttempt?: (endpoint: string) => void;
  } = {},
): Promise<{
  enriched: number;
  skipped: number;
  errors: string[];
  remaining: number;
  calls: number;
  quotaExhausted: boolean;
  nextCursor: string | null;
}> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const callBudget = opts.callBudget ?? Number.POSITIVE_INFINITY;
  const col = db.collection(REPORTS_COLLECTION);
  const explicitIds = !!opts.storeIds?.length;

  let docs: admin.firestore.QueryDocumentSnapshot[];
  let sweepCursor: string | null = null;
  if (explicitIds) {
    // Chunked `in` queries — Firestore caps `in` at 30 values.
    const chunks: string[][] = [];
    const ids = opts.storeIds ?? [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const results = await Promise.all(chunks.map((c) => col.where('storeId', 'in', c).get()));
    docs = results.flatMap((snap) => snap.docs);
  } else {
    /**
     * Rotate through the corpus by document id, resuming where the last run
     * stopped, instead of always taking the newest N. Taking the newest N meant
     * the same head was re-fetched every week (its TTL always just expired) while
     * the tail was never enriched at all.
     */
    const state = await readSyncState(db);
    const limit = opts.limit ?? 250;
    let query = col.orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
    if (state.popularityCursor) query = query.startAfter(state.popularityCursor);
    let snap = await query.get();
    // Wrap around when the sweep reaches the end of the corpus.
    if (snap.empty && state.popularityCursor) {
      snap = await col.orderBy(admin.firestore.FieldPath.documentId()).limit(limit).get();
    }
    docs = snap.docs;
    sweepCursor = docs.length > 0 ? docs[docs.length - 1].id : null;
  }

  const errors: string[] = [];
  let enriched = 0;
  let skipped = 0;
  let remaining = 0;
  let calls = 0;
  let quotaExhausted = false;

  for (const doc of docs) {
    const data = doc.data() as XrayReportDoc;
    const pop = data.popularity;
    const fresh =
      !opts.force && pop?.fetchedAt && Date.now() - new Date(pop.fetchedAt).getTime() < POPULARITY_TTL_MS;
    if (fresh) {
      skipped++;
      continue;
    }
    if (Date.now() - started > budget || calls >= callBudget) {
      remaining++;
      continue;
    }

    try {
      const { app, fromCache } = await getAppDetails(db, data.storeId, apiKey, {
        // Reuse a recent cached listing rather than spending a call on figures
        // that barely move; only a real cache miss costs quota.
        maxAgeMs: opts.force ? 0 : POPULARITY_MAX_CACHE_AGE_MS,
        onAttempt: opts.onAttempt,
      });
      if (!fromCache) calls++;
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
      // Out of quota: every further app would fail the same way, so stop rather
      // than walking the rest of the list burning requests.
      if (err instanceof AppbirdQuotaError) {
        quotaExhausted = true;
        errors.push(`AppBird quota exhausted — stopped after ${enriched} enriched: ${err.message}`);
        break;
      }
      errors.push(`${data.appName} (${data.store} ${data.storeId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Only advance the sweep when it actually got through its slice; a quota stop
  // should retry the same slice next time.
  if (!explicitIds && sweepCursor && !quotaExhausted) {
    await db
      .collection(FACETS_COLLECTION)
      .doc(SYNC_STATE_DOC)
      .set({ popularityCursor: sweepCursor }, { merge: true });
  }

  console.log(
    `xray popularity: ${enriched} enriched (${calls} AppBird calls), ${skipped} already fresh, ` +
      `${remaining} deferred, ${errors.length} errors${quotaExhausted ? ' — QUOTA EXHAUSTED' : ''}`,
  );
  return { enriched, skipped, errors, remaining, calls, quotaExhausted, nextCursor: sweepCursor };
}

/**
 * Crawl (incremental unless a full one is due) plus a budgeted slice of the
 * popularity sweep. Used by the weekly job and `xray/run`.
 *
 * Every AppBird attempt this run makes is metered and charged against a
 * self-imposed monthly budget, and the run refuses to start once that is spent —
 * automation must never be able to consume the allowance that interactive use
 * (opening a teardown or a store listing) depends on.
 */
export async function runXraySync(
  db: Firestore,
  apiKey: string,
  opts: {
    enrichLimit?: number;
    timeBudgetMs?: number;
    fullCrawl?: boolean;
    /** Cap on AppBird calls for this run. Defaults to a share of the month's budget. */
    callBudget?: number;
    /** Skip the monthly-budget gate (manual, deliberate runs only). */
    ignoreMonthlyBudget?: boolean;
  } = {},
): Promise<{
  total: number;
  pages: number;
  written: number;
  full: boolean;
  reason: string;
  enriched: number;
  skipped: number;
  remaining: number;
  errors: string[];
  calls: number;
  quotaExhausted: boolean;
  monthlyUsage: BudgetStatus;
}> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const meter = new CallMeter();

  const usage = await checkBudget(db);
  if (usage.exhausted && !opts.ignoreMonthlyBudget) {
    const reason =
      usage.exhaustedBy === 'credits'
        ? `AppBird X-Ray credit budget spent for ${usage.month} ` +
          `(${usage.xrayCreditsUsed}/${usage.xrayCreditsBudget} credits). Skipping this run so ` +
          'interactive requests keep working. Raise DEFAULT_MONTHLY_XRAY_CREDITS or pass ' +
          'ignoreMonthlyBudget to override.'
        : `AppBird monthly budget spent for ${usage.month} (${usage.used}/${usage.budget} calls). ` +
          'Skipping this run so interactive requests keep working. Raise DEFAULT_MONTHLY_BUDGET or ' +
          'pass ignoreMonthlyBudget to override.';
    console.warn(`xray sync skipped: ${reason}`);
    return {
      total: 0,
      pages: 0,
      written: 0,
      full: false,
      reason,
      enriched: 0,
      skipped: 0,
      remaining: 0,
      errors: [reason],
      calls: 0,
      quotaExhausted: true,
      monthlyUsage: usage,
    };
  }

  // Leave a slice of the remaining monthly allowance for interactive use.
  const runCallBudget = opts.callBudget ?? Math.max(Math.floor(usage.remaining * 0.5), 25);

  /**
   * Cap the crawl by what the credit budget can actually afford. A full crawl is
   * ~24 pages at 150 each, so without this a single run could spend the month's
   * X-Ray allowance in one go and starve interactive teardowns.
   */
  const affordablePages = Math.floor(usage.xrayCreditsRemaining / (XRAY_ENDPOINT_CREDITS['xray-reports'] ?? 150));

  try {
    const sync = await syncXrayReports(db, apiKey, {
      fullCrawl: opts.fullCrawl,
      maxPages: Math.max(affordablePages, 1),
      onAttempt: meter.countAttempt,
    });

    // `enrichLimit: 0` means crawl only — a fast first population, and it also
    // keeps a 0 from reaching Firestore's limit(), which rejects it.
    if (opts.enrichLimit === 0) {
      return {
        ...sync,
        enriched: 0,
        skipped: 0,
        remaining: 0,
        errors: [],
        calls: meter.total,
        quotaExhausted: false,
        monthlyUsage: usage,
      };
    }

    const popularity = await enrichXrayPopularity(db, apiKey, {
      limit: opts.enrichLimit ?? 250,
      timeBudgetMs: Math.max(budget - (Date.now() - started), 5000),
      callBudget: Math.max(runCallBudget - meter.total, 0),
      onAttempt: meter.countAttempt,
    });

    return { ...sync, ...popularity, calls: meter.total, monthlyUsage: usage };
  } finally {
    // Record what was spent even if the crawl threw partway through.
    await meter.flush(db);
    console.log(`xray sync AppBird calls: ${JSON.stringify(meter.byEndpoint())}`);
  }
}

/**
 * Everything needed to judge whether a sync is worth running — corpus size, how
 * much of it is ranked, where the sweep is, when the last crawl happened, and this
 * month's metered AppBird usage. Reads Firestore only: costs no quota.
 */
export async function getXrayStatus(db: Firestore): Promise<{
  corpus: number;
  enriched: number;
  unenriched: number;
  stalePopularity: number;
  lastTeardownDate: string | null;
  lastFullCrawlAt: string | null;
  lastSyncAt: string | null;
  popularityCursor: string | null;
  nextCrawl: { full: boolean; teardownDateFrom?: string; reason: string };
  monthlyUsage: BudgetStatus;
}> {
  const [state, usage, snap] = await Promise.all([
    readSyncState(db),
    checkBudget(db),
    db.collection(REPORTS_COLLECTION).select('popularity').get(),
  ]);

  let enriched = 0;
  let stale = 0;
  for (const doc of snap.docs) {
    const fetchedAt = (doc.data() as { popularity?: XrayPopularity | null }).popularity?.fetchedAt;
    if (!fetchedAt) continue;
    enriched++;
    if (Date.now() - new Date(fetchedAt).getTime() >= POPULARITY_TTL_MS) stale++;
  }

  const syncStateDoc = await db.collection(FACETS_COLLECTION).doc(SYNC_STATE_DOC).get();
  const lastSyncAt = syncStateDoc.data()?.lastSyncAt as admin.firestore.Timestamp | undefined;

  return {
    corpus: snap.size,
    enriched,
    unenriched: snap.size - enriched,
    stalePopularity: stale,
    lastTeardownDate: state.lastTeardownDate,
    lastFullCrawlAt: state.lastFullCrawlAt ? state.lastFullCrawlAt.toDate().toISOString() : null,
    lastSyncAt: lastSyncAt ? lastSyncAt.toDate().toISOString() : null,
    popularityCursor: state.popularityCursor,
    nextCrawl: planCrawl(state),
    monthlyUsage: usage,
  };
}

/**
 * The integration vocabulary, cached in `xrayFacets/integrations`.
 *
 * Cheapest call on the X-Ray surface, but still worth caching: the page would
 * otherwise re-fetch a list that barely changes on every load. A fetch failure
 * falls back to the stale cache when there is one — a week-old vocabulary is far
 * better than an empty filter rail, and this list is reference data, not a metric.
 */
export async function listXrayIntegrations(
  db: Firestore,
  apiKey: string,
  opts: { refresh?: boolean; onAttempt?: (endpoint: string) => void } = {},
): Promise<{ integrations: XrayIntegration[]; fromCache: boolean; fetchedAt: string | null; stale: boolean }> {
  const ref = db.collection(FACETS_COLLECTION).doc(INTEGRATIONS_DOC);

  let cached: { integrations: XrayIntegration[]; fetchedAt: string } | null = null;
  try {
    const data = (await ref.get()).data();
    const rows = data?.integrations;
    const fetchedAt = data?.fetchedAt;
    if (Array.isArray(rows) && typeof fetchedAt === 'string') {
      cached = { integrations: rows as XrayIntegration[], fetchedAt };
    }
  } catch (err) {
    console.warn('xray integrations cache read failed:', err);
  }

  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < INTEGRATIONS_TTL_MS;
  if (cached && fresh && !opts.refresh) {
    return { integrations: cached.integrations, fromCache: true, fetchedAt: cached.fetchedAt, stale: false };
  }

  try {
    const { integrations } = await getXrayIntegrations(apiKey, { onAttempt: opts.onAttempt });
    const fetchedAt = new Date().toISOString();
    try {
      await ref.set({ integrations, fetchedAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (err) {
      console.warn('xray integrations cache write failed:', err);
    }
    return { integrations, fromCache: false, fetchedAt, stale: false };
  } catch (err) {
    if (cached) {
      console.warn('xray integrations fetch failed, serving stale cache:', err);
      return { integrations: cached.integrations, fromCache: true, fetchedAt: cached.fetchedAt, stale: true };
    }
    throw err;
  }
}

export interface XrayIntegrationAppsResult {
  integration: string;
  apps: XrayIntegrationApp[];
  /** `meta.total` AppBird reported for the filter — the true membership size. */
  total: number;
  /** True when `apps` is a prefix of `total` because the page cap stopped paging. */
  partial: boolean;
  fromCache: boolean;
  fetchedAt: string | null;
  /** What the planner decided and why. Null on a plain cache hit. */
  refreshReason: string | null;
  /** Billed report pages this call spent. 0 on a cache hit. */
  pages: number;
  /** Rows upserted into `xrayReports` from the response we already paid for. */
  written: number;
}

/**
 * Which apps ship one integration, cached in `xrayIntegrationApps`.
 *
 * X-Ray's report rows carry no integration data (only `sdkCount` /
 * `adNetworkCount` totals), so this cannot be derived from the stored corpus — it
 * needs the server-side `integration` filter, billed per page. The cost policy:
 *
 * - A repeat request is free: served from Firestore, no AppBird call.
 * - A first resolve pages up to `INTEGRATION_AUTO_PAGES`, then reports `partial`
 *   with the true `total` rather than paging through the whole corpus for a broad
 *   SDK. `fetchAll` completes it when someone actually wants that.
 * - A refresh after corpus growth is incremental — one filtered page of new
 *   teardowns unioned into the cached set, not a re-resolve.
 * - Fetched rows are upserted into `xrayReports`, so a filtered query also
 *   backfills any app the crawl hasn't seen. Facets are left alone (`'skip'`):
 *   rebuilding per click would either clobber the global leaderboards or read the
 *   whole collection, and the weekly full crawl reconciles them anyway.
 */
export async function resolveXrayIntegrationApps(
  db: Firestore,
  integration: string,
  apiKey: string,
  opts: {
    refresh?: boolean;
    /** Page past `INTEGRATION_AUTO_PAGES` up to the whole corpus. Costly — opt-in. */
    fetchAll?: boolean;
    onAttempt?: (endpoint: string) => void;
  } = {},
): Promise<XrayIntegrationAppsResult> {
  const value = integration.trim();
  if (!value) throw new Error('integration must be a non-empty string');

  const ref = db.collection(INTEGRATION_APPS_COLLECTION).doc(xrayDocId('integration', value));

  let cached: XrayIntegrationAppsCache | null = null;
  try {
    const data = (await ref.get()).data() as XrayIntegrationAppsCache | undefined;
    if (data && Array.isArray(data.apps) && typeof data.fetchedAt === 'string') cached = data;
  } catch (err) {
    console.warn(`xrayIntegrationApps cache read failed for ${value}:`, err);
  }

  const corpusTeardownDate = (await readSyncState(db)).lastTeardownDate;
  const plan = planIntegrationRefresh(cached, corpusTeardownDate, {
    refresh: opts.refresh,
    fetchAll: opts.fetchAll,
  });

  if (plan.action === 'serve' && cached) {
    return {
      integration: value,
      apps: cached.apps,
      total: cached.total,
      partial: cached.partial,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
      refreshReason: null,
      pages: 0,
      written: 0,
    };
  }

  /**
   * An incremental top-up is already narrowed by `teardownDateFrom` to a few days,
   * so it is normally one page — it gets the high ceiling only as a safety valve for
   * a week when many teardowns landed at once, not as licence to crawl.
   */
  const maxPages =
    plan.action === 'incremental' || opts.fetchAll ? INTEGRATION_MAX_PAGES : INTEGRATION_AUTO_PAGES;

  const fetched: XrayReportSummary[] = [];
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;

  while (pages < maxPages) {
    const page = await getXrayReports(apiKey, {
      integration: value,
      teardownDateFrom: plan.teardownDateFrom,
      limit: XRAY_MAX_LIMIT,
      cursor,
      onAttempt: opts.onAttempt,
    });
    pages++;
    total = page.total || total;
    fetched.push(...page.reports);
    if (!page.nextCursor || page.reports.length === 0) break;
    cursor = page.nextCursor;
  }

  /**
   * An incremental top-up only ever saw the new slice, so its `meta.total` is the
   * size of that slice, not of the membership — union first, then take the count
   * from the union rather than the response.
   */
  const merged = new Map<string, XrayIntegrationApp>();
  if (plan.action === 'incremental' && cached) {
    for (const a of cached.apps) merged.set(`${a.store}:${a.storeId}`, a);
  }
  for (const r of fetched) merged.set(`${r.store}:${r.storeId}`, { store: r.store, storeId: r.storeId });
  const apps = [...merged.values()];

  const partial =
    plan.action === 'incremental'
      ? (cached?.partial ?? false)
      : // Ran out of pages with more to come: the cap stopped us short.
        pages >= maxPages && apps.length < total;
  const membershipTotal = plan.action === 'incremental' ? Math.max(total, apps.length) : total || apps.length;

  // Reuse the rows we just paid for to backfill the corpus.
  let written = 0;
  if (fetched.length > 0) {
    try {
      ({ written } = await upsertXrayReports(db, fetched, { rebuildFacetsFrom: 'skip' }));
    } catch (err) {
      console.warn('xrayIntegrationApps corpus backfill failed (membership still cached):', err);
    }
  }

  const fetchedAt = new Date().toISOString();
  const entry: XrayIntegrationAppsCache = {
    integration: value,
    apps,
    total: membershipTotal,
    partial,
    fetchedAt,
    corpusTeardownDate,
  };
  try {
    await ref.set({ ...entry, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (err) {
    console.warn(`xrayIntegrationApps cache write failed for ${value}:`, err);
  }

  console.log(
    `xray integration "${value}": ${plan.reason} — ${apps.length}/${membershipTotal} apps in ${pages} page(s)` +
      `${partial ? ' (partial)' : ''}, ${written} rows backfilled`,
  );

  return {
    integration: value,
    apps,
    total: membershipTotal,
    partial,
    fromCache: false,
    fetchedAt,
    refreshReason: plan.reason,
    pages,
    written,
  };
}

/**
 * One app's full teardown, cached in `xrayTeardowns`. Teardowns are immutable for
 * a given report, so a cache hit only re-fetches when the report id changed.
 */
export async function getXrayTeardown(
  db: Firestore,
  storeId: string,
  apiKey: string,
  opts: {
    store?: string;
    expectedReportId?: string;
    refresh?: boolean;
    onAttempt?: (endpoint: string) => void;
  } = {},
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

  const report = await getXrayReport(storeId, apiKey, opts.onAttempt);
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
