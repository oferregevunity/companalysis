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
 * - The detail path takes a **storeId**, not a reportId:
 *   `GET /v1/xray-reports/{storeId}`.
 */

export const XRAY_MAX_LIMIT = 50;

/** A row from the X-Ray report list. One report per app (no version history). */
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
  opts: XrayListFilters & { limit?: number; cursor?: string | null } = {},
): Promise<XrayListResult> {
  const { limit, cursor, ...filters } = opts;
  const url = buildUrl('xray-reports', {
    ...filters,
    limit: Math.min(limit ?? XRAY_MAX_LIMIT, XRAY_MAX_LIMIT),
    cursor: cursor ?? undefined,
  });
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return {
    reports: rows.map(normalizeXraySummary).filter((r: XrayReportSummary | null): r is XrayReportSummary => r !== null),
    total: num(data?.meta?.total),
    nextCursor: str(data?.meta?.nextCursor),
  };
}

/**
 * Every X-Ray report, following the cursor to exhaustion. ~24 calls for the
 * current corpus. `maxPages` is a runaway guard, not a normal limit.
 */
export async function getAllXrayReports(
  apiKey: string,
  opts: XrayListFilters & { maxPages?: number } = {},
): Promise<{ reports: XrayReportSummary[]; total: number; pages: number }> {
  const { maxPages = 60, ...filters } = opts;
  const byReportId = new Map<string, XrayReportSummary>();
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;

  while (pages < maxPages) {
    const page: XrayListResult = await getXrayReports(apiKey, { ...filters, limit: XRAY_MAX_LIMIT, cursor });
    pages++;
    total = page.total || total;
    for (const r of page.reports) byReportId.set(r.reportId, r);
    if (!page.nextCursor || page.reports.length === 0) break;
    cursor = page.nextCursor;
  }

  return { reports: [...byReportId.values()], total, pages };
}

/** Full teardown for one app. Note: the path param is the **storeId**. */
export async function getXrayReport(storeId: string, apiKey: string): Promise<XrayReport> {
  const url = buildUrl(`xray-reports/${encodeURIComponent(storeId)}`);
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey);
  return normalizeXrayReport(data, storeId);
}
