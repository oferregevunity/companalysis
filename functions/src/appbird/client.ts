import fetch from 'node-fetch';
import { defineSecret } from 'firebase-functions/params';

/**
 * AppBird (appbird.ai) — App Store + Google Play intelligence. We use it for the
 * ownership-transfers feed: which games moved from one developer/publisher to
 * another. Auth is an `x-api-key` header (NOT Bearer). Endpoints are per-store-id.
 */
export const appbirdApiKey = defineSecret('APPBIRD_API_KEY');

const BASE_URL = 'https://api.appbird.ai/v1';
const REQUEST_DELAY_MS = 150;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  apiKey: string,
  retries = MAX_RETRIES,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'x-api-key': apiKey } });
      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.warn(`AppBird rate limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`AppBird API error ${response.status}: ${response.statusText} - ${body.slice(0, 300)}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`AppBird request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms...`, error);
      await sleep(backoff);
    }
  }
}

/** A developer as it appears on either side of a transfer (thin — no country). */
export interface AppbirdTransferDeveloper {
  storeId: string;
  name: string;
  isStarred: boolean | null;
  isPublisher: boolean | null;
}

/** One ownership-transfer record: an app moving from one developer to another. */
export interface AppbirdOwnershipTransfer {
  app: {
    storeId: string;
    name: string;
    iconUrl: string | null;
    store: string; // "GooglePlay" | "AppStore"
  };
  fromDeveloper: AppbirdTransferDeveloper;
  toDeveloper: AppbirdTransferDeveloper;
  detectedAt: string; // ISO date-time
}

/** The primary developer object returned by GET /v1/developers/{id}. */
export interface AppbirdDeveloper {
  storeId: string;
  name: string;
  country: string | null;
  isPublisher: boolean | null;
  isStarred: boolean | null;
  iconUrl: string | null;
}

export interface AppbirdDeveloperResponse {
  developer: AppbirdDeveloper;
  countApps: number | null;
  ownershipTransfers: AppbirdOwnershipTransfer[];
  linkedDevelopers: { storeId: string; name: string; store: string }[];
}

/** A store category the app is listed under. */
export interface AppbirdCategory {
  name: string;
  slug: string;
}

/** The developer as returned inside an app-details response (richer than the transfer side). */
export interface AppbirdAppDeveloper {
  storeId: string;
  name: string;
  legalName: string | null;
  storePageUrl: string | null;
  website: string | null;
  email: string | null;
  iconUrl: string | null;
  isStarred: boolean | null;
  isPublisher: boolean | null;
}

/** The same app on the other store, when AppBird has linked the two listings. */
export interface AppbirdLinkedApp {
  store: string;
  storeId: string;
  name: string;
}

/** A current top-100 category ranking (US storefront). */
export interface AppbirdCategoryRanking {
  categoryName: string;
  categorySlug: string;
  rank: number;
  isGames: boolean;
  /** e.g. "TopFree" | "TopGrossing" | "TopPaid". */
  collection: string;
  /** e.g. "android" | "iphone" | "ipad". */
  device: string;
}

/** A store preview video (YouTube for Play, app preview for iOS). */
export interface AppbirdVideo {
  previewUrl: string | null;
  videoUrl: string | null;
}

/** A permission/privacy group: a label plus its individual entries. */
export interface AppbirdPermissionGroup {
  label: string;
  permissions: string[];
}

/** One in-app purchase item (Apple only — Play does not expose these). */
export interface AppbirdIapItem {
  title: string;
  price: string;
}

/** The storefront (country/language) the snapshot was taken from. */
export interface AppbirdStorefront {
  country: string | null;
  language: string | null;
  pageUrl: string | null;
}

/** Full app details from GET /v1/apps/{storeId}, normalized (never `undefined`). */
export interface AppbirdApp {
  storeId: string;
  store: string; // "GooglePlay" | "AppStore"
  isGame: boolean;
  bundleId: string | null;
  name: string;
  releasedAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  categories: AppbirdCategory[];
  tags: string[];
  storeTags: string[];
  iconUrl: string | null;
  coverUrl: string | null;
  developer: AppbirdAppDeveloper | null;
  storefront: AppbirdStorefront | null;
  summary: string | null;
  description: string | null;
  recentChanges: string | null;
  appVersion: string | null;
  filesize: string | null;
  screenshots: string[];
  ipadScreenshots: string[];
  videos: AppbirdVideo[];
  requiredOsVersion: string | null;
  contentRating: string | null;
  privacyPolicyUrl: string | null;
  emailSupport: string | null;
  website: string | null;
  permissions: AppbirdPermissionGroup[];
  free: boolean;
  hasIap: boolean | null;
  /** Unreleased pre-registration / pre-order listing. `null` for legacy snapshots. */
  comingSoon: boolean | null;
  iapItems: AppbirdIapItem[];
  iapPriceRange: string | null;
  price: number;
  currency: string | null;
  rating: number;
  histogram: Record<string, number>;
  numberVoters: number;
  numberReviews: number;
  installs: number;
  linkedApps: AppbirdLinkedApp[];
  categoryRankings: AppbirdCategoryRanking[];
}

function str(v: any): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: any): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function bool(v: any): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function strArray(v: any): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Coerce a raw /v1/apps payload into `AppbirdApp`. Exported for unit tests and,
 * more importantly, because the result is written straight to Firestore — which
 * rejects `undefined` — so every field must land as a value or `null`.
 */
export function normalizeApp(data: any, fallbackStoreId: string): AppbirdApp {
  const dev = data?.developer;
  const sf = data?.storefront;
  return {
    storeId: str(data?.storeId) ?? fallbackStoreId,
    store: str(data?.store) ?? 'AppStore',
    isGame: data?.isGame === true,
    bundleId: str(data?.bundleId),
    name: str(data?.name) ?? fallbackStoreId,
    releasedAt: str(data?.releasedAt),
    updatedAt: str(data?.updatedAt),
    deletedAt: str(data?.deletedAt),
    firstSeenAt: str(data?.firstSeenAt),
    lastSeenAt: str(data?.lastSeenAt),
    categories: Array.isArray(data?.categories)
      ? data.categories
          .filter((c: any) => c && typeof c === 'object')
          .map((c: any) => ({ name: str(c.name) ?? '', slug: str(c.slug) ?? '' }))
          .filter((c: AppbirdCategory) => c.name.length > 0)
      : [],
    tags: strArray(data?.tags),
    storeTags: strArray(data?.storeTags),
    iconUrl: str(data?.iconUrl),
    coverUrl: str(data?.coverUrl),
    developer: dev
      ? {
          storeId: str(dev.storeId) ?? '',
          name: str(dev.name) ?? '',
          legalName: str(dev.legalName),
          storePageUrl: str(dev.storePageUrl),
          website: str(dev.website),
          email: str(dev.email),
          iconUrl: str(dev.iconUrl),
          isStarred: bool(dev.isStarred),
          isPublisher: bool(dev.isPublisher),
        }
      : null,
    storefront: sf
      ? { country: str(sf.country), language: str(sf.language), pageUrl: str(sf.pageUrl) }
      : null,
    summary: str(data?.summary),
    description: str(data?.description),
    recentChanges: str(data?.recentChanges),
    appVersion: str(data?.appVersion),
    filesize: str(data?.filesize),
    screenshots: strArray(data?.screenshots),
    ipadScreenshots: strArray(data?.ipadScreenshots),
    videos: Array.isArray(data?.videos)
      ? data.videos
          .filter((v: any) => v && typeof v === 'object')
          .map((v: any) => ({ previewUrl: str(v.previewUrl), videoUrl: str(v.videoUrl) }))
      : [],
    requiredOsVersion: str(data?.requiredOsVersion),
    contentRating: str(data?.contentRating),
    privacyPolicyUrl: str(data?.privacyPolicyUrl),
    emailSupport: str(data?.emailSupport),
    website: str(data?.website),
    permissions: Array.isArray(data?.permissions)
      ? data.permissions
          .filter((p: any) => p && typeof p === 'object')
          .map((p: any) => ({ label: str(p.label) ?? '', permissions: strArray(p.permissions) }))
      : [],
    free: data?.free !== false,
    hasIap: bool(data?.hasIap),
    comingSoon: bool(data?.comingSoon),
    iapItems: Array.isArray(data?.iapItems)
      ? data.iapItems
          .filter((i: any) => i && typeof i === 'object')
          .map((i: any) => ({ title: str(i.title) ?? '', price: str(i.price) ?? '' }))
      : [],
    iapPriceRange: str(data?.iapPriceRange),
    price: num(data?.price),
    currency: str(data?.currency),
    rating: num(data?.rating),
    histogram:
      data?.histogram && typeof data.histogram === 'object'
        ? Object.fromEntries(
            Object.entries(data.histogram).map(([k, v]) => [k, num(v)]),
          )
        : {},
    numberVoters: num(data?.numberVoters),
    numberReviews: num(data?.numberReviews),
    installs: num(data?.installs),
    linkedApps: Array.isArray(data?.linkedApps)
      ? data.linkedApps
          .filter((a: any) => a && typeof a === 'object' && typeof a.storeId === 'string')
          .map((a: any) => ({
            store: str(a.store) ?? '',
            storeId: a.storeId as string,
            name: str(a.name) ?? (a.storeId as string),
          }))
      : [],
    categoryRankings: Array.isArray(data?.categoryRankings)
      ? data.categoryRankings
          .filter((r: any) => r && typeof r === 'object' && typeof r.rank === 'number')
          .map((r: any) => ({
            categoryName: str(r.categoryName) ?? '',
            categorySlug: str(r.categorySlug) ?? '',
            rank: r.rank as number,
            isGames: r.isGames === true,
            collection: str(r.collection) ?? '',
            device: str(r.device) ?? '',
          }))
      : [],
  };
}

/**
 * GET /v1/apps/{storeId} — full store listing for one app. `storeId` is the Play
 * package name (`com.foo.bar`) or the numeric App Store id (`6758342097`).
 */
export async function getApp(storeId: string, apiKey: string): Promise<AppbirdApp> {
  const url = `${BASE_URL}/apps/${encodeURIComponent(storeId)}`;
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey);
  return normalizeApp(data, storeId);
}

/**
 * GET /v1/developers/{developerStoreId} — 5 credits. Returns the developer plus
 * ALL ownership transfers involving them (both incoming and outgoing). This is
 * the primitive that powers the ownership-transfers feed: iterate a set of
 * tracked publisher developer ids and union their transfers.
 */
export async function getDeveloper(
  developerStoreId: string,
  apiKey: string,
): Promise<AppbirdDeveloperResponse> {
  const url = `${BASE_URL}/developers/${encodeURIComponent(developerStoreId)}`;
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey);
  const dev = data?.developer ?? {};
  return {
    developer: {
      storeId: String(dev.storeId ?? developerStoreId),
      name: dev.name ?? developerStoreId,
      country: dev.country ?? null,
      isPublisher: dev.isPublisher ?? null,
      isStarred: dev.isStarred ?? null,
      iconUrl: dev.iconUrl ?? null,
    },
    countApps: typeof data?.countApps === 'number' ? data.countApps : null,
    ownershipTransfers: Array.isArray(data?.ownershipTransfers)
      ? (data.ownershipTransfers as AppbirdOwnershipTransfer[])
      : [],
    linkedDevelopers: Array.isArray(data?.linkedDevelopers) ? data.linkedDevelopers : [],
  };
}
