import { REQUEST_DELAY_MS, buildUrl, fetchWithRetry, sleep } from './http';

/**
 * AppBird X-Ray — per-app SDK/tech teardowns (`GET /v1/xray-reports`, the "X-RAY"
 * button in AppBird's UI). This is the only AppBird surface that exposes SDK data;
 * `/v1/apps/{id}` carries none.
 *
 * Endpoint quirks established by probing the live API (there is no public spec):
 * - Pagination is **cursor-only**: pass `meta.nextCursor` back as `cursor`.
 *   `offset` is accepted and silently ignored, so paging with it loops on page 1.
 * - `limit` max is 50 (400s above that). The whole corpus is ~1200 reports.
 * - Unknown query params are silently ignored (no error), so a filter that
 *   "works" must be confirmed by watching `meta.total` change. These do filter:
 *   store, engine, mediator, publisher, search, storeId, minSdkCount,
 *   maxSdkCount, minAdNetworkCount, hasDashboard, hasDiff, teardownDateFrom.
 *   These do NOT: platform, publisherSdk, sdk/sdkName, adNetwork(s), q, appName,
 *   sortBy/orderBy, developerId, teardownDate.
 * - `integration` is documented by AppBird as a supported filter but is NEWER than
 *   our last crawl and has NOT been probe-confirmed here — and because unknown
 *   params are ignored silently, an unsupported one looks like "no filter applied"
 *   rather than an error. Confirm with `meta.total` before trusting a result set.
 *   Valid values come from `GET /v1/xray-integrations` (see `getXrayIntegrations`),
 *   which is the cheap way to enumerate them.
 * - The detail path takes a **storeId**, not a reportId:
 *   `GET /v1/xray-reports/{storeId}`.
 *
 * Request cost is NOT uniform across these paths (a report page and a teardown are
 * far dearer than the integration vocabulary), so prefer the cheap endpoint when
 * either would answer the question.
 */

export const XRAY_MAX_LIMIT = 50;

/**
 * A row from the X-Ray report list. Usually one report per app, but not
 * guaranteed — a re-teardown can leave more than one report for the same
 * store/storeId, so callers grouping by app must dedupe.
 */
export interface XrayReportSummary {
  reportId: string;
  storeId: string;
  bundleId: string | null;
  store: string; // "GooglePlay" | "AppStore"
  appName: string;
  version: string | null;
  storeVersion: string | null;
  /** Publishing partner, when the teardown identifies one (e.g. "Rollic"). */
  publisher: string | null;
  /** Publisher SDK found in the binary (e.g. "TinySauce (Voodoo)", "Self-Publish"). */
  publisherSdk: string | null;
  /** Game engine (e.g. "Unity 2022 LTS", "Native"). */
  engine: string | null;
  /** Ad mediation stack (e.g. "AppLovin MAX", "ironSource LevelPlay", "None"). */
  mediator: string | null;
  sdkCount: number;
  adNetworkCount: number;
  scriptCount: number;
  hasDashboard: boolean;
  hasDiff: boolean;
  /** Teardown date, YYYY-MM-DD. */
  teardownDate: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/** A `{label, value, note}` bullet used throughout the teardown body. */
export interface XrayDetailItem {
  label: string;
  value: string;
  note: string | null;
}

/** Who actually built the game, per the teardown's evidence trail. */
export interface XrayDeveloperFingerprint {
  studio: string | null;
  studioUrl: string | null;
  developerId: string | null;
  relationship: string | null;
  narrative: string | null;
  evidence: XrayDetailItem[];
}

/**
 * The teardown body. Every key is optional — observed reports carry 12–17 of
 * these — so the renderer must tolerate missing sections.
 */
export interface XrayReportContent {
  gameDesc: string | null;
  publisherSdk: string | null;
  attPrompt: string | null;
  arch: XrayDetailItem[];
  engine: XrayDetailItem[];
  analytics: XrayDetailItem[];
  adNetworks: XrayDetailItem[];
  coreSystems: XrayDetailItem[];
  serverDomains: XrayDetailItem[];
  publisherModules: XrayDetailItem[];
  biggestSignals: XrayDetailItem[];
  takeaways: XrayDetailItem[];
  packages: string[];
  userFlow: string[];
  adBadges: string[];
  archBadges: string[];
  developerFingerprint: XrayDeveloperFingerprint | null;
}

export interface XrayReport extends XrayReportSummary {
  content: XrayReportContent;
  /** Present when this teardown supersedes an earlier one. Shape varies; kept raw. */
  hasDiffDetail: boolean;
}

export interface XrayListResult {
  reports: XrayReportSummary[];
  total: number;
  nextCursor: string | null;
}

/** Filters accepted by `GET /v1/xray-reports` (only those confirmed to work). */
export interface XrayListFilters {
  store?: string;
  engine?: string;
  mediator?: string;
  publisher?: string;
  search?: string;
  storeId?: string;
  minSdkCount?: number;
  maxSdkCount?: number;
  minAdNetworkCount?: number;
  hasDashboard?: boolean;
  hasDiff?: boolean;
  teardownDateFrom?: string;
  /**
   * Restrict to apps shipping one integration (SDK / ad network / service). Values
   * come from `getXrayIntegrations`. Unlike the fields above this one is not
   * probe-confirmed — see the note in the module header before relying on it.
   */
  integration?: string;
}

function str(v: any): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: any): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function strArray(v: any): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function items(v: any): XrayDetailItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((i: any) => i && typeof i === 'object')
    .map((i: any) => ({ label: str(i.label) ?? '', value: str(i.value) ?? '', note: str(i.note) }))
    .filter((i) => i.label.length > 0 || i.value.length > 0);
}

/** Coerce a list row. Exported for tests; result is written to Firestore. */
export function normalizeXraySummary(raw: any): XrayReportSummary | null {
  const storeId = str(raw?.storeId);
  const reportId = str(raw?.reportId);
  if (!storeId || !reportId) return null;
  return {
    reportId,
    storeId,
    bundleId: str(raw?.bundleId),
    store: str(raw?.store) ?? 'AppStore',
    appName: str(raw?.appName) ?? storeId,
    version: str(raw?.version),
    storeVersion: str(raw?.storeVersion),
    publisher: str(raw?.publisher),
    publisherSdk: str(raw?.publisherSdk),
    engine: str(raw?.engine),
    mediator: str(raw?.mediator),
    sdkCount: num(raw?.sdkCount),
    adNetworkCount: num(raw?.adNetworkCount),
    scriptCount: num(raw?.scriptCount),
    hasDashboard: raw?.hasDashboard === true,
    hasDiff: raw?.hasDiff === true,
    teardownDate: str(raw?.teardownDate),
    publishedAt: str(raw?.publishedAt),
    updatedAt: str(raw?.updatedAt),
  };
}

/** Coerce a full teardown, null-filling every content section. */
export function normalizeXrayReport(raw: any, fallbackStoreId: string): XrayReport {
  const summary =
    normalizeXraySummary(raw) ??
    ({
      reportId: str(raw?.reportId) ?? fallbackStoreId,
      storeId: fallbackStoreId,
      bundleId: null,
      store: str(raw?.store) ?? 'AppStore',
      appName: str(raw?.appName) ?? fallbackStoreId,
      version: null,
      storeVersion: null,
      publisher: null,
      publisherSdk: null,
      engine: null,
      mediator: null,
      sdkCount: 0,
      adNetworkCount: 0,
      scriptCount: 0,
      hasDashboard: false,
      hasDiff: false,
      teardownDate: null,
      publishedAt: null,
      updatedAt: null,
    } satisfies XrayReportSummary);

  const c = raw?.content ?? {};
  const fp = c?.developerFingerprint;

  return {
    ...summary,
    hasDiffDetail: raw?.diff != null,
    content: {
      gameDesc: str(c.gameDesc),
      publisherSdk: str(c.publisherSdk),
      attPrompt: str(c.attPrompt),
      arch: items(c.arch),
      engine: items(c.engine),
      analytics: items(c.analytics),
      adNetworks: items(c.adNetworks),
      coreSystems: items(c.coreSystems),
      serverDomains: items(c.serverDomains),
      publisherModules: items(c.publisherModules),
      biggestSignals: items(c.biggestSignals),
      takeaways: items(c.takeaways),
      packages: strArray(c.packages),
      userFlow: strArray(c.userFlow),
      adBadges: strArray(c.adBadges),
      archBadges: strArray(c.archBadges),
      developerFingerprint: fp
        ? {
            studio: str(fp.studio),
            studioUrl: str(fp.studioUrl),
            developerId: str(fp.developerId),
            relationship: str(fp.relationship),
            narrative: str(fp.narrative),
            evidence: items(fp.evidence),
          }
        : null,
    },
  };
}

/** One page of X-Ray reports. Pass `cursor` from the previous result to advance. */
export async function getXrayReports(
  apiKey: string,
  opts: XrayListFilters & {
    limit?: number;
    cursor?: string | null;
    onAttempt?: (endpoint: string) => void;
  } = {},
): Promise<XrayListResult> {
  const { limit, cursor, onAttempt, ...filters } = opts;
  const url = buildUrl('xray-reports', {
    ...filters,
    limit: Math.min(limit ?? XRAY_MAX_LIMIT, XRAY_MAX_LIMIT),
    cursor: cursor ?? undefined,
  });
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey, { onAttempt });
  const rows = Array.isArray(data?.data) ? data.data : [];
  return {
    reports: rows.map(normalizeXraySummary).filter((r: XrayReportSummary | null): r is XrayReportSummary => r !== null),
    total: num(data?.meta?.total),
    nextCursor: str(data?.meta?.nextCursor),
  };
}

/**
 * Every X-Ray report matching the filters, following the cursor to exhaustion.
 * ~24 calls for the whole corpus, which is why callers should pass
 * `teardownDateFrom` to fetch only what is new. `maxPages` is a runaway guard.
 */
export async function getAllXrayReports(
  apiKey: string,
  opts: XrayListFilters & { maxPages?: number; onAttempt?: (endpoint: string) => void } = {},
): Promise<{ reports: XrayReportSummary[]; total: number; pages: number }> {
  const { maxPages = 60, onAttempt, ...filters } = opts;
  const byReportId = new Map<string, XrayReportSummary>();
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;

  while (pages < maxPages) {
    const page: XrayListResult = await getXrayReports(apiKey, {
      ...filters,
      limit: XRAY_MAX_LIMIT,
      cursor,
      onAttempt,
    });
    pages++;
    total = page.total || total;
    for (const r of page.reports) byReportId.set(r.reportId, r);
    if (!page.nextCursor || page.reports.length === 0) break;
    cursor = page.nextCursor;
  }

  return { reports: [...byReportId.values()], total, pages };
}

/**
 * One selectable integration from `GET /v1/xray-integrations` — the vocabulary of
 * SDK / ad-network / service names that the report list's `integration` filter
 * accepts.
 *
 * Worth preferring over deriving a vocabulary from crawled rows: this endpoint is
 * the cheapest on the X-Ray surface, while a report page is among the dearest, and
 * the list row carries no integration data at all (only `sdkCount` /
 * `adNetworkCount` totals and a single `publisherSdk` string).
 */
export interface XrayIntegration {
  /** What to pass as `integration` on the report list. */
  value: string;
  /** Display label. Equal to `value` when the API returns a flat string list. */
  label: string;
  /** Bucket the API assigns (e.g. ad network vs analytics). Null when absent. */
  category: string | null;
  /** Teardowns shipping it, when the API reports a count. Null when absent. */
  appCount: number | null;
}

/**
 * Coerce one integration row.
 *
 * The live shape is UNCONFIRMED — AppBird publishes no machine-readable spec, the
 * docs site is unreachable from here, and this endpoint postdates our newest
 * crawled snapshot — so this accepts both conventions seen elsewhere on the API: a
 * flat string vocabulary, or objects whose name/count keys vary. Anything
 * unrecognizable yields null and is dropped rather than becoming a junk facet.
 */
export function normalizeXrayIntegration(raw: any): XrayIntegration | null {
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value.length > 0 ? { value, label: value, category: null, appCount: null } : null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const label =
    str(raw.name) ?? str(raw.label) ?? str(raw.integration) ?? str(raw.sdk) ?? str(raw.sdkName) ?? str(raw.value);
  const value = str(raw.value) ?? str(raw.slug) ?? str(raw.id) ?? label;
  if (!label || !value) return null;

  const count = [raw.appCount, raw.reportCount, raw.appsCount, raw.count, raw.total].find(
    (n) => typeof n === 'number' && Number.isFinite(n),
  );
  return {
    value,
    label,
    category: str(raw.category) ?? str(raw.type) ?? str(raw.kind) ?? str(raw.group),
    appCount: typeof count === 'number' ? count : null,
  };
}

/**
 * The integration vocabulary. Observed sibling endpoints wrap rows in
 * `data` with a `meta.total`, but a bare array is also tolerated. No cursor is
 * followed: this is a small reference list, and if it ever paginates the caller
 * would see a short `integrations` next to a larger `total`.
 */
export async function getXrayIntegrations(
  apiKey: string,
  opts: { search?: string; limit?: number; onAttempt?: (endpoint: string) => void } = {},
): Promise<{ integrations: XrayIntegration[]; total: number }> {
  const { search, limit, onAttempt } = opts;
  const url = buildUrl('xray-integrations', { search, limit });
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey, { onAttempt });

  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.integrations)
        ? data.integrations
        : [];

  const seen = new Set<string>();
  const integrations = rows
    .map(normalizeXrayIntegration)
    .filter((i): i is XrayIntegration => i !== null)
    // A vocabulary with duplicates would render duplicate filter chips.
    .filter((i) => (seen.has(i.value) ? false : (seen.add(i.value), true)));

  return { integrations, total: num(data?.meta?.total) || integrations.length };
}

/** Full teardown for one app. Note: the path param is the **storeId**. */
export async function getXrayReport(
  storeId: string,
  apiKey: string,
  onAttempt?: (endpoint: string) => void,
): Promise<XrayReport> {
  const url = buildUrl(`xray-reports/${encodeURIComponent(storeId)}`);
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey, { onAttempt });
  return normalizeXrayReport(data, storeId);
}
