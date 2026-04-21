# Ad Creatives Competitor Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Extend the existing Firebase/React competitor-analysis app with a parallel "creative intelligence" pipeline that pulls ad creatives from Sensor Tower, scores them with a Winning Creative Score, generates Gemini explanations, and surfaces everything on a new `/creatives` page.

**Architecture:** Mirror the existing Rising Stars architecture end-to-end. Two new Cloud Functions modules (`adIntel/`, `creativeInsights/`), three new Firestore collections (`creativeSnapshots`, `creativeLatest`, `creativeInsights`), and one new React page (`/creatives`). Hook into the existing Sunday `weeklyFetch` via a per-genre fan-out so each genre stays within the 9-minute Cloud Function budget. Feature-flagged per genre for safe rollout.

**Tech Stack:** TypeScript, Firebase Cloud Functions v2, Firestore, Firebase Vertex AI (Gemini), React 19 + Vite, Vitest, existing Sensor Tower auth secret.

**Reference design:** `docs/plans/2026-04-21-ad-creatives-competitor-analysis-design.md` (read this before starting each task).

**Conventions this plan assumes (from the existing codebase):**
- All Firestore reads/writes use the named database `companalysis` via `getFirestore('companalysis')`.
- All Cloud Functions are v2 (`firebase-functions/v2/...`).
- The single HTTPS entrypoint is `compAnalysisApi` in `functions/src/index.ts` — add new routes there, not new `onRequest` exports.
- The Sensor Tower secret is `SENSOR_TOWER_AUTH_TOKEN`, imported from `functions/src/sensorTower/client.ts`.
- Tests use Vitest, live next to the source file (`foo.ts` + `foo.test.ts`), no separate `__tests__` folder for new files.
- Firestore docs never contain `undefined` — always coerce to `null`.
- TDD: failing test → minimal impl → passing test → commit.

---

## Phase 0 — Access Verification (BLOCKER)

### Task 0.1: Verify Sensor Tower Ad Intelligence access

**Files:**
- Create: `scripts/verify-ad-intel-access.ts`

**Step 1: Write the verification script**

```ts
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

const BASE_URL = 'https://api.sensortower.com/v1';

async function main() {
  const token = process.env.SENSOR_TOWER_AUTH_TOKEN?.trim();
  if (!token) {
    console.error('Set SENSOR_TOWER_AUTH_TOKEN env var (copy value from Firebase Secret Manager).');
    process.exit(2);
  }

  // Minimal Ad Intelligence endpoint: list creatives for one well-known app
  // (Candy Crush iOS = 553834731). Use a small time window & limit to keep the call cheap.
  const url = `${BASE_URL}/ios/ad_intel/creatives?` + new URLSearchParams({
    auth_token: token,
    app_ids: '553834731',
    start_date: '2026-03-01',
    end_date: '2026-03-07',
    networks: 'facebook',
    countries: 'US',
    limit: '5',
  }).toString();

  const res = await fetch(url);
  console.log('Status:', res.status, res.statusText);
  const body = await res.text();
  console.log('Body preview:', body.slice(0, 500));

  if (res.status === 200) {
    console.log('\n✅ Ad Intelligence access confirmed for the existing token.');
    process.exit(0);
  }
  if (res.status === 401 || res.status === 403) {
    console.error('\n❌ Token is NOT authorized for Ad Intelligence. Contact Sensor Tower to add the add-on or issue a separate token.');
    process.exit(1);
  }
  console.error('\n⚠️  Unexpected response — inspect body above.');
  process.exit(3);
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
```

**Step 2: Run it locally**

```bash
# From repo root. Fetch the secret once from the Firebase console.
SENSOR_TOWER_AUTH_TOKEN="$(firebase functions:secrets:access SENSOR_TOWER_AUTH_TOKEN)" \
  npx tsx scripts/verify-ad-intel-access.ts
```

Expected on success:
```
Status: 200 OK
Body preview: {"creatives": ...}
✅ Ad Intelligence access confirmed for the existing token.
```

**Step 3: Branch based on result**

- **200** → proceed to Task 0.2.
- **401/403** → STOP. Surface to the user; contact Sensor Tower; do not touch any other file until a separate `SENSOR_TOWER_AD_INTEL_TOKEN` is provisioned (then repeat with that token). Update every later task that references `sensorTowerAuthToken` to import `sensorTowerAdIntelToken` instead.
- **Other** → STOP and surface the raw body to the user.

**Step 4: Commit**

```bash
git add scripts/verify-ad-intel-access.ts
git commit -m "chore: add sensor tower ad intel access verification script"
```

---

### Task 0.2: Confirm/record exact Ad Intel endpoint shape

Sensor Tower's Ad Intel API has multiple endpoints (`/ios/ad_intel/creatives`, `/unified/creatives_v2`, `/network_analysis/...`). Before writing the client, capture **real** response JSON for the three shapes we need, so the client's types match reality.

**Files:**
- Create: `functions/src/adIntel/fixtures/creatives_ios.sample.json`
- Create: `functions/src/adIntel/fixtures/creatives_unified.sample.json`
- Create: `functions/src/adIntel/fixtures/network_share_of_voice.sample.json`

**Steps:**

1. Extend `scripts/verify-ad-intel-access.ts` temporarily (DO NOT commit) to also call:
   - `/unified/creatives_v2?...` (same params, os=unified)
   - `/ios/ad_intel/network_analysis?...` (share-of-voice per network)
2. Save each response body into the fixture files above.
3. Redact any PII/keys; keep 3-5 representative creative objects per file.
4. Revert the script changes.

**Step: Commit fixtures**

```bash
git add functions/src/adIntel/fixtures/
git commit -m "chore(ad-intel): capture sample response fixtures for client typing"
```

---

## Phase 1 — Data Ingestion (Cloud Functions)

### Task 1.1: Ad Intel TypeScript types

> **Revised after Task 0.2 fixture capture.** The original plan used invented field names (`creativeId`, `creative_url`, `share_of_voice`, flat array). The real API returns a nested `ad_units[] → creatives[]` shape with capitalized network slugs, a `phashion_group` dedup key, and `share` / `sov` numeric fields. Types below match the committed fixtures in `functions/src/adIntel/fixtures/`.

**Files:**
- Create: `functions/src/adIntel/types.ts`

**Step 1: Write the types (derived from real Sensor Tower fixtures)**

```ts
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
```

**Step 2: Commit**

```bash
git add functions/src/adIntel/types.ts
git commit -m "feat(ad-intel): add ad intel domain types"
```

---

### Task 1.2: Ad Intel client — `fetchCreativesForApp`

> **Revised after Task 0.2 fixture capture.** Endpoint changes vs the original plan:
> - Real creatives endpoint is `/v1/unified/ad_intel/creatives` (NOT `/unified/creatives_v2`; that path returns 404).
> - `ad_types` query parameter is **required** — omitting it returns `200` with an empty `ad_units` array.
> - Response is `{ count, available_networks, ad_units: [...] }` — we flatten `ad_units[]`, each row containing its own nested `creatives[]` variant list.
> - Use unified Sensor Tower app ids (the Mongo-style IDs stored in `snapshots/.../apps[].unifiedAppId`), not raw iOS/Android store IDs.
> - SoV endpoint requires `period` ∈ `day|week|month` (we use `week`), returns `{ app_id, country, network, date, sov }`.

**Files:**
- Create: `functions/src/adIntel/client.ts`
- Create: `functions/src/adIntel/client.test.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseRawCreative, parseNetworkShareOfVoice } from './client';
import creativesFixture from './fixtures/creatives_unified.sample.json';
import sovFixture from './fixtures/network_share_of_voice.sample.json';

describe('parseRawCreative', () => {
  it('normalizes a Sensor Tower ad_unit into our RawCreative shape', () => {
    const item = (creativesFixture as any).ad_units[0];
    const parsed = parseRawCreative(item, 'US');

    expect(parsed.id).toBeTypeOf('string');
    expect(parsed.network).toBe('Instagram');
    expect(parsed.country).toBe('US');
    expect(parsed.format).toBe('video');
    expect(parsed.firstSeen).toBe('2024-02-27');
    expect(parsed.lastSeen).toBe('2024-06-04');
    expect(parsed.durationDays).toBeGreaterThan(0);
    expect(parsed.share).toBeCloseTo(0.40158, 5);
    expect(parsed.mediaUrl).toMatch(/^https?:\/\//);
    expect(parsed.previewUrl).toMatch(/^https?:\/\//);
    expect(parsed.thumbnailUrl).toMatch(/^https?:\/\//);
    expect(parsed.phashionGroup).toBeTypeOf('string');
    expect(parsed.variantCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.adFormats)).toBe(true);
    expect(Array.isArray(parsed.breakdown)).toBe(true);
  });

  it('collapses multiple variants into one RawCreative with variantCount > 1', () => {
    const multi = (creativesFixture as any).ad_units.find(
      (u: any) => Array.isArray(u.creatives) && u.creatives.length > 1
    );
    expect(multi).toBeDefined();
    const parsed = parseRawCreative(multi, 'US');
    expect(parsed.variantCount).toBe(multi.creatives.length);
    // Uses the first nested variant for representative media/copy
    expect(parsed.mediaUrl).toBe(multi.creatives[0].creative_url);
  });

  it('coerces missing fields to null (never undefined)', () => {
    const parsed = parseRawCreative(
      {
        id: 'abc',
        app_id: '553834731',
        network: 'TikTok',
        phashion_group: null,
        ad_type: 'image',
        first_seen_at: '2026-01-01',
        last_seen_at: '2026-01-05',
        creatives: [],
      },
      'US'
    );
    expect(parsed.mediaUrl).toBeNull();
    expect(parsed.previewUrl).toBeNull();
    expect(parsed.thumbnailUrl).toBeNull();
    expect(parsed.videoDurationSec).toBeNull();
    expect(parsed.width).toBeNull();
    expect(parsed.height).toBeNull();
    expect(parsed.title).toBeNull();
    expect(parsed.message).toBeNull();
    expect(parsed.buttonText).toBeNull();
    expect(parsed.share).toBeNull();
    expect(parsed.phashionGroup).toBeNull();
    expect(parsed.format).toBe('image');
    expect(parsed.variantCount).toBe(0);
  });
});

describe('parseNetworkShareOfVoice', () => {
  it('normalizes a SoV row', () => {
    const row = (sovFixture as any)[0];
    const parsed = parseNetworkShareOfVoice(row, 'week');
    expect(parsed.appId).toBe(row.app_id);
    expect(parsed.network).toBe(row.network);
    expect(parsed.country).toBe(row.country);
    expect(parsed.date).toBe(row.date);
    expect(parsed.period).toBe('week');
    expect(parsed.sov).toBe(row.sov);
  });
});
```

**Step 2: Run test to verify it fails**

```
cd functions && npx vitest run src/adIntel/client.test.ts
```
Expected: FAIL with "parseRawCreative not exported".

**Step 3: Implement `client.ts`**

```ts
import fetch from 'node-fetch';
import type {
  AdNetwork,
  BreakdownBucket,
  CreativeFormat,
  NetworkShareOfVoice,
  QueryableAdNetwork,
  RawCreative,
} from './types';
import { TRACKED_NETWORKS } from './types';

const BASE_URL = 'https://api.sensortower.com/v1';
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 3;

/** All ad types the unified creatives endpoint supports. Required param. */
const AD_TYPES_ALL = ['video', 'image', 'playable', 'html'] as const;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.warn(`[adIntel] 429, backing off ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ad Intel ${res.status}: ${res.statusText} – ${body.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}

function daysBetween(a: string, b: string): number {
  const d1 = Date.parse(a);
  const d2 = Date.parse(b);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

function toCreativeFormat(adType: unknown): CreativeFormat {
  const s = String(adType ?? '').toLowerCase();
  if (s.includes('video')) return 'video';
  if (s.includes('playable')) return 'playable';
  if (s.includes('image') || s.includes('banner') || s.includes('html')) return 'image';
  return 'unknown';
}

function parseBreakdown(raw: any): BreakdownBucket[] {
  const dateArr = raw?.date;
  if (!Array.isArray(dateArr)) return [];
  const out: BreakdownBucket[] = [];
  for (const row of dateArr) {
    // shape: [[startIso, endIso], share]
    if (!Array.isArray(row) || row.length !== 2) continue;
    const range = row[0];
    const share = row[1];
    if (!Array.isArray(range) || range.length !== 2) continue;
    out.push({
      start: String(range[0] ?? ''),
      end: String(range[1] ?? ''),
      share: Number(share) || 0,
    });
  }
  return out;
}

export function parseRawCreative(adUnit: any, country: string): RawCreative {
  const firstSeen = String(adUnit.first_seen_at ?? '');
  const lastSeen = String(adUnit.last_seen_at ?? '');
  const variants: any[] = Array.isArray(adUnit.creatives) ? adUnit.creatives : [];
  const primary = variants[0] ?? {};

  return {
    id: String(adUnit.id ?? ''),
    phashionGroup:
      typeof adUnit.phashion_group === 'string' && adUnit.phashion_group.length > 0
        ? adUnit.phashion_group
        : null,
    appId: String(adUnit.app_id ?? ''),
    network: String(adUnit.network ?? '') as QueryableAdNetwork,
    country,
    format: toCreativeFormat(adUnit.ad_type),
    rawAdType: String(adUnit.ad_type ?? ''),
    firstSeen,
    lastSeen,
    durationDays: firstSeen && lastSeen ? daysBetween(firstSeen, lastSeen) : 0,
    share: typeof adUnit.share === 'number' ? adUnit.share : null,
    mediaUrl: primary.creative_url ?? null,
    previewUrl: primary.preview_url ?? null,
    thumbnailUrl: primary.thumb_url ?? null,
    videoDurationSec:
      typeof primary.video_duration === 'number' ? primary.video_duration : null,
    width: typeof primary.width === 'number' ? primary.width : null,
    height: typeof primary.height === 'number' ? primary.height : null,
    title: primary.title ?? null,
    message: primary.message ?? null,
    buttonText: primary.button_text ?? null,
    variantCount: variants.length,
    adFormats: Array.isArray(adUnit.ad_formats) ? adUnit.ad_formats.map(String) : [],
    breakdown: parseBreakdown(adUnit.breakdown),
  };
}

export function parseNetworkShareOfVoice(
  row: any,
  period: 'day' | 'week' | 'month'
): NetworkShareOfVoice {
  return {
    appId: String(row.app_id ?? ''),
    network: String(row.network ?? '') as AdNetwork,
    country: String(row.country ?? ''),
    date: String(row.date ?? ''),
    period,
    sov: Number(row.sov ?? 0),
  };
}

export interface FetchCreativesParams {
  authToken: string;
  /** Unified Sensor Tower app id (from our stored `snapshots/.../apps[].unifiedAppId`). */
  appId: string;
  network: QueryableAdNetwork;
  country: string;
  startDate: string;  // ISO
  endDate: string;    // ISO
  limit?: number;     // default 200; Sensor Tower paginates beyond this
  adTypes?: readonly string[]; // default: all
}

export async function fetchCreativesForApp(params: FetchCreativesParams): Promise<RawCreative[]> {
  const {
    authToken,
    appId,
    network,
    country,
    startDate,
    endDate,
    limit = 200,
    adTypes = AD_TYPES_ALL,
  } = params;

  const qs = new URLSearchParams({
    auth_token: authToken,
    app_ids: appId,
    networks: network,
    countries: country,
    start_date: startDate,
    end_date: endDate,
    ad_types: adTypes.join(','),
    limit: String(limit),
  });

  const url = `${BASE_URL}/unified/ad_intel/creatives?${qs.toString()}`;
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url);
  const adUnits: any[] = Array.isArray(data?.ad_units) ? data.ad_units : [];
  return adUnits.map(u => parseRawCreative(u, country));
}

export interface FetchSoVParams {
  authToken: string;
  appId: string;
  country: string;
  startDate: string;
  endDate: string;
  period?: 'day' | 'week' | 'month'; // default 'week'
}

export async function fetchNetworkShareOfVoice(
  params: FetchSoVParams
): Promise<NetworkShareOfVoice[]> {
  const {
    authToken,
    appId,
    country,
    startDate,
    endDate,
    period = 'week',
  } = params;

  const qs = new URLSearchParams({
    auth_token: authToken,
    app_ids: appId,
    countries: country,
    start_date: startDate,
    end_date: endDate,
    period,
  });

  const url = `${BASE_URL}/unified/ad_intel/network_analysis?${qs.toString()}`;
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url);
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return rows.map(r => parseNetworkShareOfVoice(r, period));
}

/** Re-export for convenience at the package boundary. */
export { TRACKED_NETWORKS };
```

**Step 4: Run test to verify it passes**

```
cd functions && npx vitest run src/adIntel/client.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add functions/src/adIntel/client.ts functions/src/adIntel/client.test.ts
git commit -m "feat(ad-intel): add sensor tower ad intel client"
```

**Notes for downstream tasks:**
- Task 1.5 (fetch orchestrator) should iterate `TRACKED_NETWORKS` and call `fetchCreativesForApp` per (app × network) — Sensor Tower does NOT support multiple networks in a single call (the param is `networks`, not `networks[]`, and comma-separating returns 422 on mixed sets).
- The cross-network dedup sub-score in Task 2.2 should key off `phashionGroup` (fall back to `id` when null) so the same concept running on Instagram + Facebook counts as **one** creative at 2 networks, not two separate creatives.
- `breakdown[].start` / `breakdown[].end` are **quarterly** in live responses; a weekly rolling 30-day window will usually see only 1-2 buckets with non-zero share. Scoring should treat an empty `breakdown` as "no extra signal" and rely on `firstSeen` / `lastSeen` / `durationDays`.

---

### Task 1.3: Watchlist Firestore shape + helper

**Files:**
- Create: `functions/src/adIntel/watchlist.ts`
- Create: `functions/src/adIntel/watchlist.test.ts`

**Shape decision:** single shared team doc at `watchlist/team` with `{ appIds: string[] }`. (Matches the "single shared team doc" decision from the design doc.)

**Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mergeAppsWithWatchlist } from './watchlist';

describe('mergeAppsWithWatchlist', () => {
  it('returns top-N apps when no watchlist', () => {
    expect(mergeAppsWithWatchlist(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('appends watchlist apps that are not already in top-N, preserving order', () => {
    expect(mergeAppsWithWatchlist(['a', 'b'], ['c', 'a', 'd']))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('deduplicates', () => {
    expect(mergeAppsWithWatchlist(['a', 'a'], ['a', 'b', 'b'])).toEqual(['a', 'b']);
  });
});
```

**Step 2: Run test to verify it fails.**

**Step 3: Implement**

```ts
import { getFirestore } from 'firebase-admin/firestore';

const WATCHLIST_DOC = 'watchlist/team';

export async function getWatchlistAppIds(): Promise<string[]> {
  const db = getFirestore('companalysis');
  const doc = await db.doc(WATCHLIST_DOC).get();
  if (!doc.exists) return [];
  const data = doc.data();
  return Array.isArray(data?.appIds) ? (data!.appIds as string[]) : [];
}

export function mergeAppsWithWatchlist(topN: string[], watchlist: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...topN, ...watchlist]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
```

**Step 4: Run test — expect PASS.**

**Step 5: Commit**

```bash
git add functions/src/adIntel/watchlist.ts functions/src/adIntel/watchlist.test.ts
git commit -m "feat(ad-intel): add watchlist helper + merge utility"
```

---

### Task 1.4: Resolve top-N apps for a genre

**Files:**
- Create: `functions/src/adIntel/appsInScope.ts`
- Create: `functions/src/adIntel/appsInScope.test.ts`

**Step 1: Failing test** — stub Firestore using an in-memory fake or by passing a loader function. For simplicity, design the function to accept a `loadLatestSnapshotApps` loader so the test doesn't need Firestore.

```ts
import { describe, it, expect } from 'vitest';
import { resolveAppsInScope } from './appsInScope';

describe('resolveAppsInScope', () => {
  it('returns top N by revenue, capped to N', async () => {
    const loader = async () => [
      { appId: 'a', revenue: 100 },
      { appId: 'b', revenue: 50 },
      { appId: 'c', revenue: 25 },
    ];
    const result = await resolveAppsInScope({ genreId: 'g1', topN: 2, loadLatestSnapshotApps: loader, watchlist: [] });
    expect(result).toEqual(['a', 'b']);
  });

  it('merges watchlist even if outside top N', async () => {
    const loader = async () => [
      { appId: 'a', revenue: 100 },
      { appId: 'b', revenue: 50 },
    ];
    const result = await resolveAppsInScope({ genreId: 'g1', topN: 1, loadLatestSnapshotApps: loader, watchlist: ['z'] });
    expect(result).toEqual(['a', 'z']);
  });
});
```

**Step 2: Run — fail.**

**Step 3: Implement**

```ts
import { getFirestore } from 'firebase-admin/firestore';
import { mergeAppsWithWatchlist } from './watchlist';

export interface ResolveAppsParams {
  genreId: string;
  topN: number;
  watchlist: string[];
  loadLatestSnapshotApps?: (genreId: string) => Promise<{ appId: string; revenue: number }[]>;
}

async function defaultLoader(genreId: string): Promise<{ appId: string; revenue: number }[]> {
  const db = getFirestore('companalysis');
  const snaps = await db.collection('snapshots')
    .where('genreId', '==', genreId)
    .orderBy('month', 'desc')
    .limit(1)
    .get();
  if (snaps.empty) return [];
  const latest = snaps.docs[0];
  const apps = await latest.ref.collection('apps').get();
  return apps.docs.map(d => ({
    appId: (d.data().unifiedAppId as string) || d.id,
    revenue: (d.data().storeRevenue as number) || 0,
  }));
}

export async function resolveAppsInScope(params: ResolveAppsParams): Promise<string[]> {
  const { genreId, topN, watchlist } = params;
  const loader = params.loadLatestSnapshotApps || defaultLoader;
  const all = await loader(genreId);
  const topIds = all
    .slice()
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN)
    .map(a => a.appId);
  return mergeAppsWithWatchlist(topIds, watchlist);
}
```

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git add functions/src/adIntel/appsInScope.ts functions/src/adIntel/appsInScope.test.ts
git commit -m "feat(ad-intel): resolve top-N + watchlist apps per genre"
```

---

### Task 1.5: Creative fetch orchestrator

**Files:**
- Create: `functions/src/adIntel/fetchCreativesForGenre.ts`
- Create: `functions/src/adIntel/fetchCreativesForGenre.test.ts`

**Step 1: Failing test** — use dependency injection so the test doesn't hit Firestore or Sensor Tower.

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchCreativesForGenreWithDeps } from './fetchCreativesForGenre';
import type { RawCreative } from './types';

describe('fetchCreativesForGenreWithDeps', () => {
  it('deduplicates creatives across networks by creativeId', async () => {
    const sample: Omit<RawCreative, 'network'> = {
      creativeId: 'cr1', appId: 'a', format: 'video', firstSeen: '2026-04-01',
      lastSeen: '2026-04-20', durationDays: 19, previewUrl: null, videoUrl: null,
      thumbnailUrl: null, aspectRatio: null, countries: ['US'],
      shareOfVoice: null, impressions: null,
    };
    const resolveApps = vi.fn().mockResolvedValue(['a']);
    const fetchCreatives = vi.fn().mockImplementation(async ({ network }) => [
      { ...sample, network },
    ]);
    const writes: any[] = [];
    const writer = async (docs: any[]) => { writes.push(...docs); };

    const result = await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'x',
      resolveApps,
      fetchCreatives,
      writeSnapshot: writer,
      watchlist: [],
    });
    expect(result.creativeCount).toBe(1); // deduped across 7 networks
    expect(writes[0].networks.length).toBe(7); // merged networks array
  });
});
```

**Step 2: Run — fail.**

**Step 3: Implement**

```ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { TRACKED_NETWORKS, type AdNetwork, type RawCreative } from './types';
import { fetchCreativesForApp } from './client';
import { resolveAppsInScope } from './appsInScope';
import { getWatchlistAppIds } from './watchlist';
import type { GenreDoc } from '../sensorTower/fetchTopApps';

export interface StoredCreative {
  creativeId: string;
  appId: string;
  networks: AdNetwork[];           // every network this creative was seen on
  format: RawCreative['format'];
  firstSeen: string;
  lastSeen: string;
  durationDays: number;
  previewUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string | null;
  countries: string[];
  shareOfVoice: number | null;     // max across networks
  impressions: number | null;      // sum across networks
  genreId: string;
  capturedWeek: string;
}

interface FetchGenreResult {
  success: boolean;
  creativeCount: number;
  partialErrors: string[];
}

export interface FetchGenreDeps {
  genre: GenreDoc;
  weekStart: string;
  weekEnd: string;
  authToken: string;
  resolveApps: (genreId: string, topN: number, watchlist: string[]) => Promise<string[]>;
  fetchCreatives: (params: {
    authToken: string; appId: string; network: AdNetwork;
    country: string; startDate: string; endDate: string;
  }) => Promise<RawCreative[]>;
  writeSnapshot: (docs: StoredCreative[]) => Promise<void>;
  watchlist: string[];
  topN?: number;
}

function weekKeyFromStart(weekStart: string): string {
  const d = new Date(weekStart);
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function mergeCreatives(existing: StoredCreative | undefined, raw: RawCreative, genreId: string, capturedWeek: string): StoredCreative {
  if (!existing) {
    return {
      creativeId: raw.creativeId,
      appId: raw.appId,
      networks: [raw.network],
      format: raw.format,
      firstSeen: raw.firstSeen,
      lastSeen: raw.lastSeen,
      durationDays: raw.durationDays,
      previewUrl: raw.previewUrl,
      videoUrl: raw.videoUrl,
      thumbnailUrl: raw.thumbnailUrl,
      aspectRatio: raw.aspectRatio,
      countries: raw.countries,
      shareOfVoice: raw.shareOfVoice,
      impressions: raw.impressions,
      genreId,
      capturedWeek,
    };
  }
  return {
    ...existing,
    networks: Array.from(new Set([...existing.networks, raw.network])),
    firstSeen: existing.firstSeen < raw.firstSeen ? existing.firstSeen : raw.firstSeen,
    lastSeen: existing.lastSeen > raw.lastSeen ? existing.lastSeen : raw.lastSeen,
    durationDays: Math.max(existing.durationDays, raw.durationDays),
    countries: Array.from(new Set([...existing.countries, ...raw.countries])),
    shareOfVoice: Math.max(existing.shareOfVoice ?? 0, raw.shareOfVoice ?? 0) || null,
    impressions: (existing.impressions ?? 0) + (raw.impressions ?? 0) || null,
    previewUrl: existing.previewUrl || raw.previewUrl,
    videoUrl: existing.videoUrl || raw.videoUrl,
    thumbnailUrl: existing.thumbnailUrl || raw.thumbnailUrl,
    aspectRatio: existing.aspectRatio || raw.aspectRatio,
  };
}

export async function fetchCreativesForGenreWithDeps(deps: FetchGenreDeps): Promise<FetchGenreResult> {
  const { genre, weekStart, weekEnd, authToken, resolveApps, fetchCreatives, writeSnapshot, watchlist, topN = 25 } = deps;
  const country = genre.country || 'US';
  const week = weekKeyFromStart(weekStart);
  const partialErrors: string[] = [];

  const apps = await resolveApps(genre.id, topN, watchlist);
  const merged = new Map<string, StoredCreative>();

  for (const appId of apps) {
    for (const network of TRACKED_NETWORKS) {
      try {
        const raws = await fetchCreatives({
          authToken, appId, network, country,
          startDate: weekStart, endDate: weekEnd,
        });
        for (const raw of raws) {
          merged.set(raw.creativeId, mergeCreatives(merged.get(raw.creativeId), raw, genre.id, week));
        }
      } catch (err) {
        partialErrors.push(`app=${appId} network=${network}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const docs = Array.from(merged.values());
  await writeSnapshot(docs);

  return { success: partialErrors.length === 0, creativeCount: docs.length, partialErrors };
}

export async function fetchCreativesForGenre(
  genre: GenreDoc,
  weekStart: string,
  weekEnd: string,
  authToken: string
): Promise<FetchGenreResult> {
  const watchlist = await getWatchlistAppIds();
  const db = getFirestore('companalysis');
  const week = weekKeyFromStart(weekStart);
  const snapshotRef = db.collection('creativeSnapshots').doc(`${genre.id}_week_${week}`);

  return fetchCreativesForGenreWithDeps({
    genre,
    weekStart,
    weekEnd,
    authToken,
    watchlist,
    resolveApps: (genreId, topN, wl) => resolveAppsInScope({ genreId, topN, watchlist: wl }),
    fetchCreatives: fetchCreativesForApp,
    writeSnapshot: async (docs) => {
      await snapshotRef.set({
        genreId: genre.id,
        week,
        weekStart,
        weekEnd,
        fetchedAt: FieldValue.serverTimestamp(),
        creativeCount: docs.length,
      });
      const BATCH = 400;
      for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        const batch = db.batch();
        for (const doc of chunk) {
          batch.set(snapshotRef.collection('creatives').doc(doc.creativeId), doc);
          batch.set(db.collection('creativeLatest').doc(doc.creativeId), doc);
        }
        await batch.commit();
      }
    },
  });
}
```

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git add functions/src/adIntel/fetchCreativesForGenre.ts functions/src/adIntel/fetchCreativesForGenre.test.ts
git commit -m "feat(ad-intel): add per-genre creatives fetch orchestrator"
```

---

### Task 1.6: Staleness reaper

**Files:**
- Create: `functions/src/adIntel/reaper.ts`
- Create: `functions/src/adIntel/reaper.test.ts`

**Step 1: Failing test** — verifies a creative with `lastSeen` > 60 days ago is queued for deletion.

```ts
import { describe, it, expect } from 'vitest';
import { selectStaleCreatives } from './reaper';

describe('selectStaleCreatives', () => {
  it('returns creatives whose lastSeen is older than the threshold', () => {
    const now = new Date('2026-04-21');
    const fresh = { creativeId: 'fresh', lastSeen: '2026-04-01' };
    const stale = { creativeId: 'stale', lastSeen: '2026-01-01' };
    const result = selectStaleCreatives([fresh, stale] as any, now, 60);
    expect(result.map(c => c.creativeId)).toEqual(['stale']);
  });
});
```

**Step 2: Run — fail.**

**Step 3: Implement**

```ts
import { getFirestore } from 'firebase-admin/firestore';
import type { StoredCreative } from './fetchCreativesForGenre';

export function selectStaleCreatives(
  creatives: Pick<StoredCreative, 'creativeId' | 'lastSeen'>[],
  now: Date,
  thresholdDays: number
): Pick<StoredCreative, 'creativeId' | 'lastSeen'>[] {
  const cutoff = now.getTime() - thresholdDays * 86400000;
  return creatives.filter(c => {
    const ts = Date.parse(c.lastSeen);
    return Number.isFinite(ts) && ts < cutoff;
  });
}

export async function reapStaleCreatives(thresholdDays = 60): Promise<number> {
  const db = getFirestore('companalysis');
  const all = await db.collection('creativeLatest').get();
  const stale = selectStaleCreatives(
    all.docs.map(d => ({ creativeId: d.id, lastSeen: d.data().lastSeen || '' })),
    new Date(),
    thresholdDays
  );
  const BATCH = 400;
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = db.batch();
    for (const c of stale.slice(i, i + BATCH)) {
      batch.delete(db.collection('creativeLatest').doc(c.creativeId));
    }
    await batch.commit();
  }
  return stale.length;
}
```

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git add functions/src/adIntel/reaper.ts functions/src/adIntel/reaper.test.ts
git commit -m "feat(ad-intel): add creativeLatest staleness reaper"
```

---

## Phase 2 — Winning Creative Scoring Engine

### Task 2.1: Sub-score — Longevity

**Files:**
- Create: `functions/src/creativeInsights/scoringEngine.ts`
- Create: `functions/src/creativeInsights/scoringEngine.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeLongevity } from './scoringEngine';

describe('computeLongevity', () => {
  it('returns 0 for 0-day creatives', () => {
    expect(computeLongevity(0)).toBe(0);
  });
  it('returns ~8 pts at 7 days', () => {
    const v = computeLongevity(7);
    expect(v).toBeGreaterThanOrEqual(7);
    expect(v).toBeLessThanOrEqual(10);
  });
  it('returns ~18 pts at 30 days', () => {
    const v = computeLongevity(30);
    expect(v).toBeGreaterThanOrEqual(16);
    expect(v).toBeLessThanOrEqual(20);
  });
  it('caps at 25 pts at 60+ days', () => {
    expect(computeLongevity(60)).toBe(25);
    expect(computeLongevity(200)).toBe(25);
  });
});
```

**Step 2: Run — fail.**

**Step 3: Implement (append to `scoringEngine.ts`)**

```ts
/**
 * Logarithmic curve calibrated so:
 *   7 days  → ~8
 *   30 days → ~18
 *   60 days → 25 (cap)
 */
export function computeLongevity(days: number): number {
  if (days <= 0) return 0;
  if (days >= 60) return 25;
  const scaled = 25 * Math.log(days + 1) / Math.log(61);
  return Math.round(scaled * 10) / 10;
}
```

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git add functions/src/creativeInsights/scoringEngine.ts functions/src/creativeInsights/scoringEngine.test.ts
git commit -m "feat(creative-insights): add longevity sub-score"
```

---

### Task 2.2: Sub-score — Network Breadth

**Step 1: Failing test** (append to `scoringEngine.test.ts`):

```ts
import { computeNetworkBreadth } from './scoringEngine';

describe('computeNetworkBreadth', () => {
  it('returns 0 for empty', () => expect(computeNetworkBreadth([])).toBe(0));
  it('returns 4 for 1 network', () => expect(computeNetworkBreadth(['facebook'])).toBe(4));
  it('returns 25 for 7 networks', () => {
    const all = ['facebook', 'tiktok', 'applovin', 'unity', 'youtube', 'google_ads', 'ironsource'] as any;
    expect(computeNetworkBreadth(all)).toBe(25);
  });
  it('deduplicates', () => {
    expect(computeNetworkBreadth(['facebook', 'facebook'] as any)).toBe(4);
  });
});
```

**Step 2: Run — fail.**

**Step 3: Implement:**

```ts
import type { AdNetwork } from '../adIntel/types';

export function computeNetworkBreadth(networks: AdNetwork[]): number {
  const count = new Set(networks).size;
  if (count <= 0) return 0;
  return Math.min(25, Math.round((count / 7) * 25 * 10) / 10 || 4);
}
```

**Step 4: Run — pass. Step 5: Commit.**

```bash
git commit -am "feat(creative-insights): add network breadth sub-score"
```

---

### Task 2.3: Sub-score — Impression Momentum

**Step 1: Failing test** — three levels: accelerating SoV, flat SoV, unavailable (null fallback to country-growth).

```ts
import { computeImpressionMomentum } from './scoringEngine';

describe('computeImpressionMomentum', () => {
  it('returns 0 when no data', () => {
    expect(computeImpressionMomentum({ sovByWeek: {}, countriesByWeek: {} })).toBe(0);
  });
  it('rewards accelerating SoV', () => {
    const score = computeImpressionMomentum({
      sovByWeek: { 'w1': 0.01, 'w2': 0.03, 'w3': 0.08, 'w4': 0.20 },
      countriesByWeek: {},
    });
    expect(score).toBeGreaterThan(15);
  });
  it('falls back to country-count growth when SoV missing', () => {
    const score = computeImpressionMomentum({
      sovByWeek: {},
      countriesByWeek: { 'w1': 1, 'w2': 2, 'w3': 4, 'w4': 8 },
    });
    expect(score).toBeGreaterThan(10);
  });
});
```

**Step 2: Run — fail.**

**Step 3: Implement** — reuse the WMA+acceleration logic pattern from `insights/scoringEngine.ts::computeRevenueAcceleration` (read that file and adapt; **do not** duplicate; extract a private helper `accelerationScore(values: number[], maxPts = 25)` if both files benefit).

```ts
function percentChanges(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev <= 0) continue;
    out.push(((values[i] - prev) / prev) * 100);
  }
  return out;
}

function accelerationScore(values: number[], maxPts: number): number {
  if (values.length < 2) return 0;
  const pct = percentChanges(values);
  if (pct.length === 0) return 0;
  // weighted average: recent periods weighted 2x, 3x, ...
  let weighted = 0, totalW = 0;
  pct.forEach((v, i) => { const w = i + 1; weighted += v * w; totalW += w; });
  const avg = weighted / totalW;
  if (avg <= 0) return 0;
  const base = Math.min(maxPts * 0.6, avg / 10);
  const accelerating = pct.every((v, i) => i === 0 || v >= pct[i - 1]);
  const bonus = accelerating ? maxPts * 0.4 : 0;
  return Math.min(maxPts, Math.round((base + bonus) * 10) / 10);
}

export interface ImpressionMomentumInput {
  sovByWeek: Record<string, number>;        // share-of-voice per ISO week key
  countriesByWeek: Record<string, number>;  // distinct-country count per week (fallback)
}

export function computeImpressionMomentum(input: ImpressionMomentumInput): number {
  const sovKeys = Object.keys(input.sovByWeek).sort();
  if (sovKeys.length >= 2) {
    return accelerationScore(sovKeys.map(k => input.sovByWeek[k]), 25);
  }
  const countryKeys = Object.keys(input.countriesByWeek).sort();
  if (countryKeys.length >= 2) {
    return accelerationScore(countryKeys.map(k => input.countriesByWeek[k]), 25);
  }
  return 0;
}
```

**Step 4: Run — pass. Step 5: Commit.**

```bash
git commit -am "feat(creative-insights): add impression momentum sub-score"
```

---

### Task 2.4: Sub-score — Freshness-Adjusted Persistence

**Step 1: Failing test**

```ts
import { computeFreshnessAdjustedPersistence } from './scoringEngine';

describe('computeFreshnessAdjustedPersistence', () => {
  const now = new Date('2026-04-21');
  it('returns 0 for a creative first seen 180 days ago', () => {
    expect(computeFreshnessAdjustedPersistence({
      firstSeen: '2025-10-01', durationDays: 180,
    }, now)).toBe(0);
  });
  it('returns 0 for a creative running < 14 days (not yet proven)', () => {
    expect(computeFreshnessAdjustedPersistence({
      firstSeen: '2026-04-15', durationDays: 6,
    }, now)).toBe(0);
  });
  it('returns ~25 for an 18-day-old creative still running', () => {
    const v = computeFreshnessAdjustedPersistence({
      firstSeen: '2026-04-03', durationDays: 18,
    }, now);
    expect(v).toBeGreaterThanOrEqual(20);
    expect(v).toBeLessThanOrEqual(25);
  });
});
```

**Step 2: Fail. Step 3: Implement:**

```ts
export function computeFreshnessAdjustedPersistence(
  input: { firstSeen: string; durationDays: number },
  now: Date = new Date()
): number {
  const firstSeenTs = Date.parse(input.firstSeen);
  if (!Number.isFinite(firstSeenTs)) return 0;
  const ageDays = (now.getTime() - firstSeenTs) / 86400000;
  if (ageDays > 21) return 0;
  if (input.durationDays < 14) return 0;
  const ratio = (21 - ageDays) / 7;
  return Math.min(25, Math.max(0, Math.round(25 * (0.5 + 0.5 * ratio) * 10) / 10));
}
```

**Step 4: Pass. Step 5: Commit.**

```bash
git commit -am "feat(creative-insights): add freshness-adjusted persistence sub-score"
```

---

### Task 2.5: Composite scorer + selectTopWinners

**Step 1: Failing test**

```ts
import { computeWinningCreativeScore, selectTopWinners } from './scoringEngine';

describe('computeWinningCreativeScore', () => {
  it('averages 4 sub-scores to a 0-100 composite', () => {
    const r = computeWinningCreativeScore({
      longevity: 20, networkBreadth: 20, impressionMomentum: 20, freshnessAdjustedPersistence: 20,
    });
    expect(r).toBe(80);
  });
});

describe('selectTopWinners', () => {
  it('returns top 10 above threshold, sorted desc', () => {
    const inputs = Array.from({ length: 15 }, (_, i) => ({
      creativeId: `c${i}`, score: 10 + i * 5, // 10..80
    }));
    const winners = selectTopWinners(inputs, 10, 60);
    expect(winners.length).toBeLessThanOrEqual(10);
    expect(winners.every(w => w.score >= 60)).toBe(true);
    expect(winners[0].score).toBeGreaterThanOrEqual(winners[winners.length - 1].score);
  });
});
```

**Step 2: Fail. Step 3: Implement:**

```ts
export interface SubScores {
  longevity: number;
  networkBreadth: number;
  impressionMomentum: number;
  freshnessAdjustedPersistence: number;
}

export function computeWinningCreativeScore(s: SubScores): number {
  const sum = s.longevity + s.networkBreadth + s.impressionMomentum + s.freshnessAdjustedPersistence;
  return Math.round(sum * 10) / 10;   // already on 0-100 because 4×25 = 100
}

export function selectTopWinners<T extends { score: number }>(items: T[], topK: number, threshold: number): T[] {
  return items
    .filter(i => i.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

**Step 4: Pass. Step 5: Commit.**

```bash
git commit -am "feat(creative-insights): add composite scorer and winner selection"
```

---

### Task 2.6: Scoring pipeline — load data + write scores

**Files:**
- Create: `functions/src/creativeInsights/scoringPipeline.ts`
- Create: `functions/src/creativeInsights/scoringPipeline.test.ts`

**Step 1: Failing test** — inject a `loadCreatives` and `writeScores` to avoid Firestore.

```ts
import { describe, it, expect, vi } from 'vitest';
import { scoreCreativesForGenreWithDeps } from './scoringPipeline';

describe('scoreCreativesForGenreWithDeps', () => {
  it('scores all creatives and writes results', async () => {
    const load = vi.fn().mockResolvedValue([{
      creativeId: 'c1', appId: 'a', networks: ['facebook'], firstSeen: '2026-04-01',
      lastSeen: '2026-04-20', durationDays: 19, shareOfVoice: null, impressions: null,
      countries: ['US'], capturedWeek: '2026-W16',
    }]);
    const writes: any[] = [];
    const write = async (rows: any[]) => { writes.push(...rows); };
    const result = await scoreCreativesForGenreWithDeps({
      genreId: 'g1', week: '2026-W16', loadCreatives: load, writeScores: write, now: new Date('2026-04-21'),
    });
    expect(result.scored).toBe(1);
    expect(writes[0].score).toBeGreaterThan(0);
    expect(writes[0].subScores).toBeDefined();
  });
});
```

**Step 2: Fail. Step 3: Implement:**

```ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';
import {
  computeLongevity, computeNetworkBreadth, computeImpressionMomentum,
  computeFreshnessAdjustedPersistence, computeWinningCreativeScore,
} from './scoringEngine';

export interface CreativeScoreRow {
  creativeId: string;
  appId: string;
  score: number;
  subScores: {
    longevity: number;
    networkBreadth: number;
    impressionMomentum: number;
    freshnessAdjustedPersistence: number;
  };
  computedAt: FirebaseFirestore.FieldValue;
}

export interface ScoreDeps {
  genreId: string;
  week: string;
  loadCreatives: (genreId: string, week: string) => Promise<StoredCreative[]>;
  writeScores: (rows: CreativeScoreRow[]) => Promise<void>;
  now?: Date;
}

export async function scoreCreativesForGenreWithDeps(deps: ScoreDeps): Promise<{ scored: number }> {
  const { genreId, week, loadCreatives, writeScores, now = new Date() } = deps;
  const creatives = await loadCreatives(genreId, week);
  const rows: CreativeScoreRow[] = creatives.map(c => {
    const sub = {
      longevity: computeLongevity(c.durationDays),
      networkBreadth: computeNetworkBreadth(c.networks),
      impressionMomentum: computeImpressionMomentum({
        sovByWeek: c.shareOfVoice != null ? { [week]: c.shareOfVoice } : {},
        countriesByWeek: { [week]: c.countries.length },
      }),
      freshnessAdjustedPersistence: computeFreshnessAdjustedPersistence({
        firstSeen: c.firstSeen, durationDays: c.durationDays,
      }, now),
    };
    return {
      creativeId: c.creativeId,
      appId: c.appId,
      score: computeWinningCreativeScore(sub),
      subScores: sub,
      computedAt: FieldValue.serverTimestamp(),
    };
  });
  await writeScores(rows);
  return { scored: rows.length };
}

export async function scoreCreativesForGenre(genreId: string, week: string): Promise<{ scored: number }> {
  const db = getFirestore('companalysis');
  const insightDocRef = db.collection('creativeInsights').doc(`${genreId}_week_${week}`);
  return scoreCreativesForGenreWithDeps({
    genreId, week,
    loadCreatives: async () => {
      const snap = await db.collection('creativeSnapshots').doc(`${genreId}_week_${week}`).collection('creatives').get();
      return snap.docs.map(d => d.data() as StoredCreative);
    },
    writeScores: async (rows) => {
      const BATCH = 400;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = db.batch();
        for (const r of rows.slice(i, i + BATCH)) {
          batch.set(insightDocRef.collection('scores').doc(r.creativeId), r);
        }
        await batch.commit();
      }
      await insightDocRef.set({
        genreId, week,
        scoredAt: FieldValue.serverTimestamp(),
        scoredCount: rows.length,
      }, { merge: true });
    },
  });
}
```

**Step 4: Pass. Step 5: Commit.**

```bash
git add functions/src/creativeInsights/scoringPipeline.ts functions/src/creativeInsights/scoringPipeline.test.ts
git commit -m "feat(creative-insights): add scoring pipeline + Firestore wiring"
```

---

## Phase 3 — Gemini Insights Layer

### Task 3.1: Gemini client for creatives

**Files:**
- Create: `functions/src/creativeInsights/geminiClient.ts`
- Create: `functions/src/creativeInsights/geminiClient.test.ts`

**Step 1: Read existing `functions/src/insights/geminiClient.ts`** — copy the auth/init/model selection pattern. Do not reinvent; import the shared `getGeminiModel()` if one exists, or extract one in this task.

**Step 2: Failing test** — use a mocked `model` stub.

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildCreativePrompt, parseCreativeResponse } from './geminiClient';

describe('buildCreativePrompt', () => {
  it('includes genre, week, and each winner\'s networks and sub-scores', () => {
    const p = buildCreativePrompt({
      genreName: 'Match 3', week: '2026-W16',
      winners: [{
        creativeId: 'c1', appId: 'a', appName: 'Candy', publisherName: 'King',
        networks: ['facebook', 'tiktok'], format: 'video',
        durationDays: 19, firstSeen: '2026-04-01',
        score: 72, subScores: { longevity: 15, networkBreadth: 8, impressionMomentum: 20, freshnessAdjustedPersistence: 25 },
      }],
    });
    expect(p).toContain('Match 3');
    expect(p).toContain('facebook');
    expect(p).toContain('tiktok');
    expect(p).toContain('72');
  });
});

describe('parseCreativeResponse', () => {
  it('extracts summary, winners, emergingConcepts, watchList from valid JSON', () => {
    const parsed = parseCreativeResponse(JSON.stringify({
      summary: 's',
      winners: [{ creativeId: 'c1', explanation: 'e' }],
      emergingConcepts: [{ title: 't', description: 'd', exampleCreativeIds: ['c1'] }],
      watchList: [{ creativeId: 'c2', reason: 'r' }],
    }));
    expect(parsed.summary).toBe('s');
    expect(parsed.winners[0].creativeId).toBe('c1');
    expect(parsed.emergingConcepts[0].title).toBe('t');
    expect(parsed.watchList[0].creativeId).toBe('c2');
  });
  it('returns empty structure for malformed JSON', () => {
    const parsed = parseCreativeResponse('not json');
    expect(parsed.summary).toBe('');
    expect(parsed.winners).toEqual([]);
  });
});
```

**Step 3: Fail. Step 4: Implement** — mirror `insights/geminiClient.ts` closely. Prompt template (inline):

```ts
export function buildCreativePrompt(input: {...}): string {
  // Multi-line prompt that asks for JSON-only output with this schema:
  // { summary: string, winners: [{creativeId, explanation}], emergingConcepts: [{title, description, exampleCreativeIds}], watchList: [{creativeId, reason}] }
  // Include winners with their networks, sub-scores, firstSeen, durationDays, format.
}

export function parseCreativeResponse(raw: string): { summary; winners; emergingConcepts; watchList } {
  try {
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const obj = JSON.parse(cleaned);
    return {
      summary: String(obj.summary || ''),
      winners: Array.isArray(obj.winners) ? obj.winners : [],
      emergingConcepts: Array.isArray(obj.emergingConcepts) ? obj.emergingConcepts : [],
      watchList: Array.isArray(obj.watchList) ? obj.watchList : [],
    };
  } catch {
    return { summary: '', winners: [], emergingConcepts: [], watchList: [] };
  }
}

export async function generateCreativeInsights(input: ...): Promise<...> {
  // Call Gemini via the existing client helper, send buildCreativePrompt + (optionally) thumbnail image parts, parse with parseCreativeResponse.
  // Return { summary, winners, emergingConcepts, watchList, rawError?: string }.
}
```

**Step 5: Pass. Step 6: Commit.**

```bash
git commit -am "feat(creative-insights): add gemini client for creative insights"
```

---

### Task 3.2: Creative insights pipeline (scoring → Gemini → write)

**Files:**
- Create: `functions/src/creativeInsights/pipeline.ts`
- Create: `functions/src/creativeInsights/pipeline.test.ts`

**Step 1: Failing test** — DI for `loadScores`, `loadCreatives`, `callGemini`, `write`.

**Step 2: Implement** the orchestrator:

1. Load all scores for `{genreId}_week_{week}` from Firestore.
2. Select top-10 winners (`score >= 60`) and 20 concept-candidates (next-highest 20) and 5 watch-list candidates (scores 50-59).
3. Join creatives data (name, networks, thumbnail) from `creativeSnapshots/.../creatives`.
4. Call `generateCreativeInsights(...)`.
5. Write `creativeInsights/{genreId}_week_{week}` with the `CreativeInsightDoc` schema from the design doc.
6. Handle Gemini failure gracefully — write the doc with `summary: ''`, `winners: []`, `generatedAt: serverTimestamp()`, `geminiError: err.message` so the UI can degrade.

**Step 3-4: Pass. Step 5: Commit.**

```bash
git commit -am "feat(creative-insights): add end-to-end insights pipeline"
```

---

### Task 3.3: Orchestrator for one genre (fetch → score → insights)

**Files:**
- Create: `functions/src/creativeInsights/runForGenre.ts`
- Create: `functions/src/creativeInsights/runForGenre.test.ts`

**Step 1: Failing test** — verifies order-of-calls with DI stubs.

**Step 2: Implement:**

```ts
export async function runCreativePipelineForGenre(
  genre: GenreDoc,
  weekStart: string,
  weekEnd: string,
  authToken: string
): Promise<{
  success: boolean;
  creativeCount: number;
  scoredCount: number;
  insightsGenerated: boolean;
  partialErrors: string[];
}> {
  const fetchResult = await fetchCreativesForGenre(genre, weekStart, weekEnd, authToken);
  const week = weekKeyFromStart(weekStart);
  const scoreResult = await scoreCreativesForGenre(genre.id, week);
  let insightsGenerated = false;
  try {
    await generateAndStoreCreativeInsights(genre.id, week);
    insightsGenerated = true;
  } catch (err) {
    fetchResult.partialErrors.push(`gemini: ${err}`);
  }
  return {
    success: fetchResult.success && insightsGenerated,
    creativeCount: fetchResult.creativeCount,
    scoredCount: scoreResult.scored,
    insightsGenerated,
    partialErrors: fetchResult.partialErrors,
  };
}
```

**Step 3: Pass. Step 4: Commit.**

```bash
git commit -am "feat(creative-insights): add per-genre orchestrator"
```

---

## Phase 4 — API Routes, Firestore Rules, Indexes

### Task 4.1: Firestore rules

**Files:**
- Modify: `firestore.rules`

**Step 1: Read existing rules.** Identify the auth predicate used for `snapshots/` and `insights/`. Add parallel rules for `creativeSnapshots`, `creativeLatest`, `creativeInsights`, and `watchlist`:

```
match /creativeSnapshots/{doc=**}  { allow read: if request.auth != null; allow write: if false; }
match /creativeLatest/{doc}        { allow read: if request.auth != null; allow write: if false; }
match /creativeInsights/{doc=**}   { allow read: if request.auth != null; allow write: if false; }
match /watchlist/{doc}             { allow read, write: if request.auth != null; }
```

**Step 2: Commit.**

```bash
git add firestore.rules
git commit -m "chore(firestore): add rules for creatives + watchlist collections"
```

---

### Task 4.2: Firestore composite indexes

**Files:**
- Modify: `firestore.indexes.json`

**Step 1: Add composite indexes:**

```json
{
  "collectionGroup": "creativeLatest",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "genreId", "order": "ASCENDING" },
    { "fieldPath": "durationDays", "order": "DESCENDING" }
  ]
}
```

…plus `(genreId, firstSeen desc)` and `(genreId, capturedWeek desc)`. For `creativeInsights` scoring subcollection: `(score desc)`.

**Step 2: Commit.**

```bash
git add firestore.indexes.json
git commit -m "chore(firestore): add indexes for creative gallery queries"
```

---

### Task 4.3: API routes — `creatives/trigger`, `creatives/watchlist`

**Files:**
- Modify: `functions/src/index.ts`

**Step 1: Add route handlers** (copy style of the existing `insights/generate-genre` and `savedViews/invite` handlers):

- `POST creatives/trigger`: body `{ genreId, weekStart, weekEnd? }` → looks up genre, runs `runCreativePipelineForGenre`, returns result JSON.
- `POST creatives/watchlist/add`: body `{ appId }` → arrayUnion into `watchlist/team`.
- `POST creatives/watchlist/remove`: body `{ appId }` → arrayRemove.
- `GET  creatives/watchlist`: returns current app IDs.

Keep all handlers inside the existing `switch (path)` — do not export a new `onRequest`.

**Step 2: Commit.**

```bash
git commit -am "feat(api): add creatives trigger + watchlist endpoints"
```

---

### Task 4.4: Feature flag on genre docs

**Files:**
- Modify: `functions/src/sensorTower/fetchTopApps.ts` (the `GenreDoc` interface) — add `enableCreatives?: boolean`.
- Modify: `functions/src/index.ts` — `genres/update` allowlist to include `enableCreatives`.

**Step 1: Implement + commit.**

```bash
git commit -am "feat(genres): add enableCreatives feature flag field"
```

---

## Phase 5 — Scheduled Job + Frontend

### Task 5.1: Extend Sunday scheduled job

**Files:**
- Modify: `functions/src/scheduled/weeklyFetch.ts`

**Step 1: After the existing loop**, for each genre where `genre.enableCreatives === true`, call `runCreativePipelineForGenre(genre, prevWeekStart, prevWeekEnd, authToken)`. Record result into the same `fetchLogs` doc. Then at the end, call `reapStaleCreatives()`.

**Key code sketch:**

```ts
import { runCreativePipelineForGenre } from '../creativeInsights/runForGenre';
import { reapStaleCreatives } from '../adIntel/reaper';
import { getPreviousCompleteWeek } from '../sensorTower/fetchTopApps';

// inside the handler, AFTER existing genre loop:
const prevWeek = getPreviousCompleteWeek();
for (const doc of genresSnapshot.docs) {
  const genre = { id: doc.id, ...doc.data() } as any;
  if (!genre.enableCreatives) continue;
  try {
    const r = await runCreativePipelineForGenre(genre, prevWeek.startDate, prevWeek.endDate, authToken);
    console.log(`Creative pipeline ${genre.name}: creatives=${r.creativeCount} scored=${r.scoredCount} insights=${r.insightsGenerated}`);
    if (r.partialErrors.length) allErrors.push(...r.partialErrors.map(e => `[${genre.name}] ${e}`));
  } catch (err) {
    allErrors.push(`Creatives failed ${genre.name}: ${err}`);
  }
}
const reaped = await reapStaleCreatives();
console.log(`Reaped ${reaped} stale creatives`);
```

**Step 2: Commit.**

```bash
git commit -am "feat(scheduled): add creatives pipeline to sunday job"
```

---

### Task 5.2: Frontend types + API helpers

**Files:**
- Create: `frontend/src/types/creatives.ts`
- Create: `frontend/src/lib/creativesApi.ts`

**Step 1: Mirror backend types**

```ts
export type CreativeFormat = 'video' | 'image' | 'playable' | 'unknown';
export type AdNetwork = 'facebook' | 'tiktok' | 'applovin' | 'unity' | 'youtube' | 'google_ads' | 'ironsource';

export interface StoredCreative {
  creativeId: string;
  appId: string;
  networks: AdNetwork[];
  format: CreativeFormat;
  firstSeen: string;
  lastSeen: string;
  durationDays: number;
  previewUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string | null;
  countries: string[];
  shareOfVoice: number | null;
  impressions: number | null;
  genreId: string;
  capturedWeek: string;
}

export interface CreativeScoreRow {
  creativeId: string;
  appId: string;
  score: number;
  subScores: {
    longevity: number;
    networkBreadth: number;
    impressionMomentum: number;
    freshnessAdjustedPersistence: number;
  };
}

export interface CreativeInsightDoc {
  genreId: string;
  week: string;
  generatedAt?: { seconds: number; nanoseconds: number };
  summary: string;
  winners: Array<{ creativeId: string; appId: string; appName: string; rank: number; score: number; subScores: CreativeScoreRow['subScores']; explanation: string }>;
  emergingConcepts: Array<{ title: string; description: string; exampleCreativeIds: string[] }>;
  watchList: Array<{ creativeId: string; appId: string; appName: string; score: number; reason: string }>;
  geminiError?: string;
}
```

**Step 2: API helpers** (mirror `frontend/src/lib/api.ts` if it exists).

```ts
export async function triggerCreativesForGenre(genreId: string, token: string) { ... }
export async function addToWatchlist(appId: string, token: string) { ... }
export async function removeFromWatchlist(appId: string, token: string) { ... }
```

**Step 3: Commit.**

```bash
git add frontend/src/types/creatives.ts frontend/src/lib/creativesApi.ts
git commit -m "feat(frontend): add creatives types and api helpers"
```

---

### Task 5.3: React hooks for creatives data

**Files:**
- Create: `frontend/src/hooks/useCreativeInsights.ts`
- Create: `frontend/src/hooks/useCreativesForGenre.ts`
- Create: `frontend/src/hooks/useCreativeWatchlist.ts`

**Pattern:** copy the Firestore listener pattern from an existing hook (examine `useGenreDataStatus.ts` first). Each hook returns `{ data, loading, error }`.

```ts
// useCreativeInsights.ts
export function useCreativeInsights(genreId: string, week: string) {
  const [data, setData] = useState<CreativeInsightDoc | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'creativeInsights', `${genreId}_week_${week}`),
      (snap) => { setData((snap.data() as any) || null); setLoading(false); },
      (err) => { console.error(err); setLoading(false); }
    );
    return () => unsub();
  }, [genreId, week]);
  return { data, loading };
}
```

Similar shape for the other two. `useCreativesForGenre` joins `creativeLatest` (filtered by `genreId`) with scores from `creativeInsights/{genreId}_week_{latestWeek}/scores` — merge client-side in a `useMemo`.

**Commit each hook separately:**

```bash
git add frontend/src/hooks/useCreativeInsights.ts && git commit -m "feat(frontend): add useCreativeInsights hook"
git add frontend/src/hooks/useCreativesForGenre.ts && git commit -m "feat(frontend): add useCreativesForGenre hook"
git add frontend/src/hooks/useCreativeWatchlist.ts && git commit -m "feat(frontend): add useCreativeWatchlist hook"
```

---

### Task 5.4: `/creatives` page — shell + genre selector + freshness

**Files:**
- Create: `frontend/src/pages/Creatives.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: sidebar/nav component (add link — find it via `grep -R "Dashboard" frontend/src/components`)

**Step 1: Minimal page that renders the genre pill selector and "Last analyzed X ago" status from `useCreativeInsights`.**

Commit:
```bash
git commit -am "feat(creatives): add /creatives page shell with genre selector"
```

---

### Task 5.5: AI Highlights strip

**Files:**
- Create: `frontend/src/components/creatives/AIHighlightsStrip.tsx`
- Modify: `frontend/src/pages/Creatives.tsx`

**Step 1: Render three cards side-by-side** — Genre Summary, Emerging Concepts (3 cards with up to 4 example thumbnails each), Watch List (2-3 tiles). Pull from `useCreativeInsights(genreId, latestWeek)`. Clicking an example thumbnail scrolls the main gallery to the matching creative (`document.getElementById(`creative-${id}`)?.scrollIntoView({ behavior: 'smooth' })`).

**Step 2: Degraded-mode banner** when `data.geminiError` is truthy or `summary` is empty: "AI insights unavailable for this run, showing statistical scores only."

**Commit.**

```bash
git commit -am "feat(creatives): add AI Highlights strip with summary, concepts, watchlist"
```

---

### Task 5.6: Creative Gallery grid + tile

**Files:**
- Create: `frontend/src/components/creatives/CreativeTile.tsx`
- Create: `frontend/src/components/creatives/CreativeGallery.tsx`
- Modify: `frontend/src/pages/Creatives.tsx`

**CreativeTile props:** `creative: StoredCreative & { score?: number; subScores?: SubScores; rankBadge?: number }` plus `onOpen: (id: string) => void`.

**Tile content (top → bottom):**
- `<img>` thumbnail (or `<video muted loop>` for videos, `onMouseEnter={e => e.currentTarget.play()}`).
- Score badge (top-right absolute), color class by range (`<40` gray, `40-59` yellow, `60-79` green, `80+` emerald).
- Rank badge (top-left) only if `rankBadge` is set.
- Network chips row.
- Format chip.
- App name + publisher link.
- `"Running {durationDays}d · First seen {firstSeen}"` caption.
- Subtle glow wrapper div (`className="winner-glow"`) when `rankBadge && rankBadge <= 10`.

**Gallery:** CSS grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`), takes `creatives[]` and the joined score map.

**Step: Commit.**

```bash
git commit -am "feat(creatives): add gallery grid and tile component"
```

---

### Task 5.7: Filters + search

**Files:**
- Create: `frontend/src/components/creatives/CreativeFilters.tsx`
- Modify: `frontend/src/pages/Creatives.tsx`

**State shape:**

```ts
interface Filters {
  networks: Set<AdNetwork>;
  formats: Set<CreativeFormat>;
  appIds: Set<string>;
  newThisWeek: boolean;
  winnersOnly: boolean;
  sort: 'score' | 'duration' | 'firstSeen' | 'sov';
  search: string;
}
```

Filter logic lives in `useCreativesForGenre(genreId, filters)` — push the filter into the hook so filtering happens after the Firestore read but before rendering. Keep it pure client-side; no new Firestore queries.

Commit:
```bash
git commit -am "feat(creatives): add gallery filters, sort, and search"
```

---

### Task 5.8: Creative detail modal

**Files:**
- Create: `frontend/src/components/creatives/CreativeDetailModal.tsx`
- Modify: `frontend/src/pages/Creatives.tsx` (wire open/close)

**Content:** full-size video/image player, 4 sub-score mini bars, Gemini explanation text (from the matching winner or watchlist entry in the insight doc; fallback: "No AI explanation for this creative"), "Open in Sensor Tower" external link built from `creativeId`.

Commit:
```bash
git commit -am "feat(creatives): add creative detail modal with full player and sub-scores"
```

---

### Task 5.9: Settings — Competitor Watchlist UI

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`

**Add section:** "Competitor Watchlist" with an autocomplete app picker (reuse whatever autocomplete exists for the main genre flow; if none, a simple controlled `<input>` with a list of recently-seen apps pulled from `appNames` is acceptable for MVP) and a table of current watchlist apps with remove buttons. Wire to `useCreativeWatchlist` and `addToWatchlist`/`removeFromWatchlist`.

Commit:
```bash
git commit -am "feat(settings): add competitor watchlist UI"
```

---

### Task 5.10: "Re-analyze" button + status wiring

**Files:**
- Modify: `frontend/src/pages/Creatives.tsx`
- Modify: `frontend/src/hooks/useGenreDataStatus.ts` (add creatives row)

**Step 1:** Button calls `triggerCreativesForGenre(genreId, token)`; disable while in flight; show success/error toast. Re-fetch by relying on the existing Firestore listener to emit once the pipeline writes.

**Step 2:** Add "Creatives: last fetched / last analyzed / last errored" fields to `useGenreDataStatus` by reading `creativeSnapshots/{genreId}_week_*` and `creativeInsights/{genreId}_week_*` (use `limit(1)` + `orderBy('fetchedAt', 'desc')`).

**Step 3: Commit.**

```bash
git commit -am "feat(creatives): add re-analyze button and status wiring"
```

---

## Phase 6 — Integration Test + Rollout

### Task 6.1: End-to-end integration test (mocked Sensor Tower + Gemini)

**Files:**
- Create: `functions/src/creativeInsights/e2e.test.ts`

**Step 1:** Using `@firebase/rules-unit-testing` or the existing test-setup pattern (`functions/src/__tests__/setup.test.ts`), write a single test that:

1. Seeds `snapshots/{genre}_{month}/apps` with 3 apps.
2. Seeds `watchlist/team.appIds = [...]` with 1 extra app.
3. Stubs `fetchCreativesForApp` to return 2 creatives per (app, network) — some overlapping across networks.
4. Stubs Gemini to return a fixed JSON response.
5. Runs `runCreativePipelineForGenre`.
6. Asserts Firestore contains `creativeSnapshots/.../creatives` (deduped count), `creativeLatest/...`, `creativeInsights/{genreId}_week_{week}` with `summary`, `winners`, `emergingConcepts`.

**Step 2: Commit.**

```bash
git commit -am "test(creative-insights): add e2e integration test"
```

---

### Task 6.2: Rollout — enable flag on pilot genre, manual run

**Files:** none (configuration only).

**Steps:**

1. Deploy Cloud Functions + rules: `cd functions && npm run deploy` (or `scripts/deploy-prod.sh`).
2. In the Firebase console, set `genres/{pilotGenreId}.enableCreatives = true` for one low-risk genre (e.g. the smallest one).
3. From the deployed app, trigger `POST /creatives/trigger` with that `genreId` and the previous full week.
4. Verify in Firestore console that `creativeSnapshots`, `creativeLatest`, `creativeInsights` docs appear with sensible shapes.
5. Visit `/creatives` and check rendering end-to-end.

**No commit for this task.** Report results to the user.

---

### Task 6.3: Rollout — enable flag on all genres

After 1 week of the pilot genre running without issue on the Sunday job:

1. Set `enableCreatives = true` on every active genre.
2. Monitor Sunday's `fetchLogs` doc for partial errors.
3. If any per-genre timeouts appear → open follow-up task for Cloud Tasks escape hatch (out of scope for this plan).

---

## Out of Scope (DO NOT implement in this plan)

- Uploading our own creatives for A/B comparison
- Creative performance attribution to our install data
- Automated thumbnail/video re-hosting in Firebase Storage
- Daily or twice-weekly cadence
- Per-app drill-down page (the Dashboard link per-tile is sufficient for MVP)
- Share-to-Slack for individual creatives
- Cloud Tasks fan-out (only add if real timeouts appear in production)

---

## Verification checklist (before declaring done)

- [ ] Task 0 returned `200` from Sensor Tower Ad Intel.
- [ ] All Vitest unit tests pass: `cd functions && npm test`.
- [ ] Integration test passes.
- [ ] `firebase deploy --only functions,firestore:rules,firestore:indexes` succeeds.
- [ ] `/creatives` page renders without console errors for a genre with `enableCreatives = true`.
- [ ] Gallery shows non-zero creatives and scores after manual trigger.
- [ ] Re-analyze button updates `generatedAt` in the UI within ~2 minutes.
- [ ] Watchlist add/remove persists and influences the next run's app scope.
- [ ] Sunday scheduled run completes with 0 `errors` in `fetchLogs` for creative-enabled genres.
