import type { XrayReportSummary } from './xrayClient';

/**
 * X-Ray's `mediator` / `publisherSdk` / `engine` fields are free text written per
 * teardown, so the same product appears under many spellings — "AppLovin MAX",
 * "MAX", "AppLovin MAX (via Elephant)"; "Self-Publish" vs "Self-Published";
 * "ElephantSDK" vs "ElephantSDK (Rollic)"; "Unity 6.3" vs "Unity 2022 LTS".
 *
 * These pure helpers collapse those into stable groups so the page can facet on
 * them. Grouping runs server-side and the result is stored on each report doc, so
 * the client never re-derives it (one source of truth, and re-grouping later only
 * needs a re-run of the weekly job).
 */

/** The three facet dimensions the page can pivot on. */
export type XrayDimension = 'mediator' | 'publisherSdk' | 'engine';

export interface XrayGrouped {
  /** Stable grouping key, e.g. "applovin-max". */
  key: string;
  /** Display label for the group, e.g. "AppLovin MAX". */
  label: string;
  /**
   * The distinguishing remainder of the raw value when it differs from the group,
   * e.g. "via Elephant" or the publisher that owns the SDK. Null when the raw
   * value is just the group.
   */
  variant: string | null;
}

const UNKNOWN: XrayGrouped = { key: 'unknown', label: 'Unknown', variant: null };
const NONE: XrayGrouped = { key: 'none', label: 'None', variant: null };

/**
 * Grouping key for values we have no explicit rule for. Separators are dropped
 * rather than collapsed to dashes so spacing/casing drift between teardowns —
 * "CleverAdsSolutions" vs "Clever Ads Solutions" — lands in one group.
 */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
}

/** Pull a trailing "(...)" qualifier off a value: "X (via Y)" → ["X", "via Y"]. */
function splitTrailingParen(raw: string): [string, string | null] {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw.trim());
  if (!m) return [raw.trim(), null];
  const base = m[1].trim();
  const inner = m[2].trim();
  return base.length > 0 ? [base, inner.length > 0 ? inner : null] : [raw.trim(), null];
}

/**
 * Ad mediation stack. Matched on the raw string (case-insensitive) because the
 * qualifier can appear anywhere: "ironSource LevelPlay (via Supersonic Wisdom)".
 */
export function normalizeMediator(raw: string | null | undefined): XrayGrouped {
  if (!raw || !raw.trim()) return UNKNOWN;
  const value = raw.trim();
  const lower = value.toLowerCase();
  const [, paren] = splitTrailingParen(value);

  // "None", "None (dummy ads)" — no mediation in the build.
  if (/^none\b/.test(lower)) return { ...NONE, variant: paren };

  const group = (key: string, label: string): XrayGrouped => {
    // Keep the raw value as the variant when it says more than the group label.
    const variant = lower === label.toLowerCase() ? null : (paren ?? value);
    return { key, label, variant };
  };

  // LevelPlay is the ironSource/Unity mediation product — one group, since a
  // teardown may name either brand for the same SDK.
  if (/levelplay|ironsource/.test(lower)) return group('levelplay', 'LevelPlay (ironSource)');
  // "MAX" alone is AppLovin MAX; guard the word so "MAXimum" doesn't match.
  if (/applovin|\bmax\b/.test(lower)) return group('applovin-max', 'AppLovin MAX');
  if (/admob|google mobile ads/.test(lower)) return group('admob', 'AdMob');

  // Publisher-owned wrappers, checked only after the real mediation products
  // above: "AppLovin MAX (via Elephant)" is MAX mediation that Elephant wraps, so
  // it must group under MAX, not under ElephantSDK. These match when the wrapper
  // is the only thing named ("VoodooSauce built-in", "TSAdsManager").
  if (/voodoo|tinysauce|tiny sauce|tsadsmanager/.test(lower)) return group('tinysauce', 'TinySauce (Voodoo)');
  if (/homa/.test(lower)) return group('homa', 'Homa (HomaBelly)');
  if (/supersonic ?wisdom/.test(lower)) return group('supersonicwisdom', 'SupersonicWisdom (Supersonic)');
  if (/elephant|rollicmax/.test(lower)) return group('elephantsdk', 'ElephantSDK (Rollic)');
  if (/topon|anythink/.test(lower)) return group('topon', 'TopOn');
  if (/hyperbid/.test(lower)) return group('hyperbid', 'HyperBid');
  if (/bidmachine/.test(lower)) return group('bidmachine', 'BidMachine');
  if (/pangle|bytedance|union ?ad/.test(lower)) return group('pangle', 'Pangle');
  if (/tradplus/.test(lower)) return group('tradplus', 'TradPlus');
  if (/fairbid|digital turbine/.test(lower)) return group('fairbid', 'Digital Turbine FairBid');

  // Unrecognized: group on the value minus any trailing qualifier.
  const [base, variant] = splitTrailingParen(value);
  return { key: slug(base), label: base, variant };
}

/**
 * Publisher SDK. Values look like "TinySauce (Voodoo)" or
 * "ElephantSDK / RollicMAX (Rollic)" — the parenthetical is the owning publisher,
 * which we keep as the variant.
 */
export function normalizePublisherSdk(raw: string | null | undefined): XrayGrouped {
  if (!raw || !raw.trim()) return UNKNOWN;
  const value = raw.trim();
  const lower = value.toLowerCase();

  if (/^no publisher sdk|^none\b/.test(lower)) return NONE;
  if (/^self[- ]?publish/.test(lower)) return { key: 'self-publish', label: 'Self-Publish', variant: null };

  const [beforeParen, owner] = splitTrailingParen(value);
  // "ElephantSDK / RollicMAX" — the first name is the primary SDK.
  const primary = beforeParen.split(/\s*\/\s*/)[0].trim() || beforeParen;
  const lowerPrimary = primary.toLowerCase();

  // Known SDKs whose spelling drifts between teardowns.
  const aliases: [RegExp, string][] = [
    [/supersonic\s*wisdom/, 'SupersonicWisdom'],
    [/elephant/, 'ElephantSDK'],
    [/tinysauce/, 'TinySauce'],
    [/lion studios suite/, 'Lion Studios Suite'],
    [/saykit/, 'SayKit'],
    [/falcon/, 'Falcon SDK'],
    [/\bclik\b/, 'CLIK'],
    [/\bmads\b|muads/, 'MADS'],
    [/bravestars/, 'BravestarsSDK'],
  ];
  for (const [re, label] of aliases) {
    if (re.test(lowerPrimary)) return { key: slug(label), label, variant: owner };
  }

  return { key: slug(primary), label: primary, variant: owner };
}

/** Engine, split into a family group with the version kept as the variant. */
export function normalizeEngine(raw: string | null | undefined): XrayGrouped {
  if (!raw || !raw.trim()) return UNKNOWN;
  const value = raw.trim();
  const lower = value.toLowerCase();

  if (/^unity/.test(lower)) {
    const version = value.replace(/^unity\s*/i, '').trim();
    return { key: 'unity', label: 'Unity', variant: version.length > 0 ? version : null };
  }
  if (/unreal/.test(lower)) {
    const version = value.replace(/^unreal\s*(engine)?\s*/i, '').trim();
    return { key: 'unreal', label: 'Unreal', variant: version.length > 0 ? version : null };
  }
  if (/^native/.test(lower)) {
    const [, paren] = splitTrailingParen(value);
    return { key: 'native', label: 'Native', variant: paren };
  }
  if (/godot/.test(lower)) return { key: 'godot', label: 'Godot', variant: null };
  if (/cocos/.test(lower)) return { key: 'cocos', label: 'Cocos', variant: null };
  if (/flutter/.test(lower)) return { key: 'flutter', label: 'Flutter', variant: null };
  if (/react ?native/.test(lower)) return { key: 'react-native', label: 'React Native', variant: null };

  const [base, variant] = splitTrailingParen(value);
  return { key: slug(base), label: base, variant };
}

/** Normalized facet keys/labels stored alongside each report. */
export interface XrayReportFacets {
  mediatorKey: string;
  mediatorLabel: string;
  mediatorVariant: string | null;
  publisherSdkKey: string;
  publisherSdkLabel: string;
  publisherSdkVariant: string | null;
  engineKey: string;
  engineLabel: string;
  engineVersion: string | null;
}

export function reportFacets(report: XrayReportSummary): XrayReportFacets {
  const mediator = normalizeMediator(report.mediator);
  const publisherSdk = normalizePublisherSdk(report.publisherSdk);
  const engine = normalizeEngine(report.engine);
  return {
    mediatorKey: mediator.key,
    mediatorLabel: mediator.label,
    mediatorVariant: mediator.variant,
    publisherSdkKey: publisherSdk.key,
    publisherSdkLabel: publisherSdk.label,
    publisherSdkVariant: publisherSdk.variant,
    engineKey: engine.key,
    engineLabel: engine.label,
    engineVersion: engine.variant,
  };
}

/** One row of a facet leaderboard. */
export interface XrayFacetBucket {
  key: string;
  label: string;
  count: number;
  /** Share of all reports, 0–100, one decimal. */
  sharePct: number;
  /** Store split, useful context since iOS/Play stacks differ. */
  appStoreCount: number;
  googlePlayCount: number;
  /** Most common raw variants inside the group, biggest first (max 5). */
  topVariants: { label: string; count: number }[];
}

export interface XrayFacets {
  /** Total reports the buckets were computed from. */
  totalReports: number;
  mediator: XrayFacetBucket[];
  publisherSdk: XrayFacetBucket[];
  engine: XrayFacetBucket[];
}

function bucketize(
  reports: XrayReportSummary[],
  pick: (r: XrayReportSummary) => XrayGrouped,
): XrayFacetBucket[] {
  const acc = new Map<
    string,
    { label: string; count: number; ios: number; play: number; variants: Map<string, number> }
  >();

  for (const r of reports) {
    const g = pick(r);
    const entry = acc.get(g.key) ?? { label: g.label, count: 0, ios: 0, play: 0, variants: new Map() };
    entry.count++;
    if (r.store === 'GooglePlay') entry.play++;
    else entry.ios++;
    if (g.variant) entry.variants.set(g.variant, (entry.variants.get(g.variant) ?? 0) + 1);
    acc.set(g.key, entry);
  }

  const total = reports.length || 1;
  return [...acc.entries()]
    .map(([key, e]) => ({
      key,
      label: e.label,
      count: e.count,
      sharePct: Math.round((e.count / total) * 1000) / 10,
      appStoreCount: e.ios,
      googlePlayCount: e.play,
      topVariants: [...e.variants.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Facet leaderboards across the whole corpus, each dimension sorted by count. */
export function buildFacets(reports: XrayReportSummary[]): XrayFacets {
  return {
    totalReports: reports.length,
    mediator: bucketize(reports, (r) => normalizeMediator(r.mediator)),
    publisherSdk: bucketize(reports, (r) => normalizePublisherSdk(r.publisherSdk)),
    engine: bucketize(reports, (r) => normalizeEngine(r.engine)),
  };
}
