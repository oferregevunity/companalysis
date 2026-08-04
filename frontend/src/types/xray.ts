/**
 * AppBird X-Ray shapes, mirroring `functions/src/appbird/xrayClient.ts` and
 * `xrayFacets.ts`. Report rows + facet leaderboards are read from Firestore
 * (`xrayReports`, `xrayFacets/latest`); full teardowns come from the
 * `xray/report` route.
 */

/** Store popularity, back-filled from AppBird app details (X-Ray has none). */
export interface XrayPopularity {
  iconUrl: string | null;
  /** Play install count. 0 on the App Store, which publishes no installs. */
  installs: number;
  /** Rating count — the only popularity signal both stores expose. */
  numberVoters: number;
  rating: number;
  /** Best current top-100 category rank, when the app charts. */
  bestRank: number | null;
  comingSoon: boolean | null;
  fetchedAt: string;
}

/** One report row: the X-Ray summary plus normalized facets and popularity. */
export interface XrayReportRow {
  reportId: string;
  storeId: string;
  bundleId: string | null;
  store: string; // "GooglePlay" | "AppStore"
  appName: string;
  version: string | null;
  storeVersion: string | null;
  publisher: string | null;
  publisherSdk: string | null;
  engine: string | null;
  mediator: string | null;
  sdkCount: number;
  adNetworkCount: number;
  scriptCount: number;
  hasDashboard: boolean;
  hasDiff: boolean;
  teardownDate: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  // Normalized facet fields, computed server-side so the client never re-derives.
  mediatorKey: string;
  mediatorLabel: string;
  mediatorVariant: string | null;
  publisherSdkKey: string;
  publisherSdkLabel: string;
  publisherSdkVariant: string | null;
  engineKey: string;
  engineLabel: string;
  engineVersion: string | null;
  popularity?: XrayPopularity | null;
}

export interface XrayFacetBucket {
  key: string;
  label: string;
  count: number;
  /** Share of all reports, 0–100. */
  sharePct: number;
  appStoreCount: number;
  googlePlayCount: number;
  topVariants: { label: string; count: number }[];
}

/** The three dimensions the page can pivot on. */
export type XrayDimension = 'mediator' | 'publisherSdk' | 'engine';

export interface XrayFacets {
  totalReports: number;
  mediator: XrayFacetBucket[];
  publisherSdk: XrayFacetBucket[];
  engine: XrayFacetBucket[];
}

/** A `{label, value, note}` bullet used throughout a teardown body. */
export interface XrayDetailItem {
  label: string;
  value: string;
  note: string | null;
}

export interface XrayDeveloperFingerprint {
  studio: string | null;
  studioUrl: string | null;
  developerId: string | null;
  relationship: string | null;
  narrative: string | null;
  evidence: XrayDetailItem[];
}

/** Teardown body. Every section is optional — reports carry 12–17 of them. */
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

export interface XrayTeardown extends Omit<XrayReportRow, 'popularity'> {
  content: XrayReportContent;
  hasDiffDetail: boolean;
}

export interface XrayTeardownResult {
  report: XrayTeardown;
  fromCache: boolean;
}

export interface XrayPopularityResult {
  enriched: number;
  skipped: number;
  errors: string[];
  remaining: number;
}

/**
 * One value accepted by the report list's `integration` filter. Mirrors
 * `XrayIntegration` in `functions/src/appbird/xrayClient.ts`.
 */
export interface XrayIntegration {
  value: string;
  label: string;
  category: string | null;
  appCount: number | null;
}

export interface XrayIntegrationsResult {
  integrations: XrayIntegration[];
  fromCache: boolean;
  fetchedAt: string | null;
  /** True when AppBird failed and this is a fallback to an expired cache. */
  stale: boolean;
}

export interface XrayIntegrationApp {
  store: string;
  storeId: string;
}

export interface XrayIntegrationAppsResult {
  integration: string;
  apps: XrayIntegrationApp[];
  /** True membership size, which can exceed `apps.length` when `partial`. */
  total: number;
  /** `apps` is a capped prefix of `total`; completing it costs more requests. */
  partial: boolean;
  fromCache: boolean;
  fetchedAt: string | null;
  refreshReason: string | null;
  pages: number;
  written: number;
}
