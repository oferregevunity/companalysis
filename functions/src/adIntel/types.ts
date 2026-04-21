/**
 * Ad Intel domain types. Mapped from the Sensor Tower responses captured in
 * `functions/src/adIntel/fixtures/`. Sensor Tower's `ad_units[]` rows are our
 * logical "creative" (one per perceptual-hash group per network); nested
 * `creatives[]` are size/locale variants of the same concept and are collapsed
 * into a single representative preview on our side.
 */

/** Creative media type, derived from Sensor Tower's `ad_type` string. */
export type CreativeFormat = 'video' | 'image' | 'playable' | 'unknown';

/**
 * Networks the Sensor Tower creative-listing endpoint will accept in the
 * `networks` query parameter. Capitalized per the real API (lowercase
 * variants return 422). Meta's Facebook inventory is exposed as "Instagram"
 * or "Facebook" depending on placement; there is no "facebook" slug.
 */
export type QueryableAdNetwork =
  | 'Instagram'
  | 'Facebook'
  | 'Meta Audience Network'
  | 'TikTok'
  | 'Youtube'
  | 'Admob'
  | 'Applovin'
  | 'Unity'
  | 'Vungle'
  | 'Mintegral'
  | 'IronSource'
  | 'Chartboost';

/**
 * Networks we track for competitive intelligence. Subset of all observable
 * networks in Sensor Tower's SoV response (which also returns BidMachine,
 * Moloco, Digital Turbine, Smaato, Verve, Supersonic, InMobi, etc. — these
 * are aggregators/exchanges and not interesting for creative scraping).
 */
export const TRACKED_NETWORKS: readonly QueryableAdNetwork[] = [
  'Instagram',
  'Facebook',
  'Meta Audience Network',
  'TikTok',
  'Youtube',
  'Admob',
  'Applovin',
  'Unity',
  'IronSource',
] as const;

/** Any Sensor Tower network slug (including ones we don't scrape creatives for). */
export type AdNetwork = QueryableAdNetwork | string;

/** One date-bucketed data point from `ad_units[].breakdown.date`. */
export interface BreakdownBucket {
  /** Inclusive ISO start, e.g. `"2024-04-01T00:00:00Z"`. */
  start: string;
  /** Inclusive ISO end, e.g. `"2024-06-30T00:00:00Z"`. */
  end: string;
  /** Share in [0, 1] — fraction of this ad_unit's activity in the bucket. */
  share: number;
}

/**
 * One logical creative = one `ad_unit` from Sensor Tower. Nested size/locale
 * variants in `ad_units[].creatives[]` are collapsed into a single
 * representative preview plus a `variantCount`.
 */
export interface RawCreative {
  /** Stable per-ad_unit id (Sensor Tower's `ad_units[].id`). */
  id: string;
  /**
   * Perceptual-hash group id — the same concept across networks shares this
   * value (Sensor Tower's `ad_units[].phashion_group`). Use this as the
   * cross-network dedup key.
   */
  phashionGroup: string | null;
  /** Unified Sensor Tower app id (e.g. `"5f16a8019f7b275235017614"`). */
  appId: string;
  network: QueryableAdNetwork;
  /** Country the scrape was scoped to (the API does not echo this back). */
  country: string;
  format: CreativeFormat;
  /** Raw `ad_type` string from the API, preserved for debugging. */
  rawAdType: string;
  /** ISO date (`YYYY-MM-DD`) from `first_seen_at`. */
  firstSeen: string;
  /** ISO date (`YYYY-MM-DD`) from `last_seen_at`. */
  lastSeen: string;
  /** Days between firstSeen and lastSeen, clamped ≥ 0. */
  durationDays: number;
  /**
   * Fraction (0–1) of THIS app's ads on THIS network/country that belong to
   * this ad_unit, per Sensor Tower's `ad_units[].share`. Not the same as SoV
   * across apps — use `NetworkShareOfVoice` for that.
   */
  share: number | null;
  /** Representative media URL (first nested `creatives[].creative_url`). */
  mediaUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  /** Seconds, from the representative variant's `video_duration`. */
  videoDurationSec: number | null;
  width: number | null;
  height: number | null;
  /** Ad copy from the representative variant. */
  title: string | null;
  message: string | null;
  buttonText: string | null;
  /** Number of nested `creatives[]` variants (locales/aspect ratios). */
  variantCount: number;
  /** `ad_units[].ad_formats` echoed through, e.g. `["other"]` or `["reward"]`. */
  adFormats: string[];
  /** Optional time-series breakdown; may be empty when the API returns none. */
  breakdown: BreakdownBucket[];
}

/** One row from `/v1/unified/ad_intel/network_analysis`. */
export interface NetworkShareOfVoice {
  appId: string;
  /** Any Sensor Tower network slug (SoV covers a broader set than we scrape). */
  network: AdNetwork;
  country: string;
  /** ISO date at the start of the period (day/week/month-aligned). */
  date: string;
  period: 'day' | 'week' | 'month';
  /** 0–1. */
  sov: number;
}
