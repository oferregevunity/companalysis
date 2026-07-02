import * as admin from 'firebase-admin';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export type Granularity = 'month' | 'week';

/**
 * Pre-pivoted, denormalized read model for the dashboard.
 *
 * The dashboard needs a table of (app × period) but the source of truth is one
 * Firestore document per app, per period, per genre. Reading that on every page
 * load fans out to tens of thousands of document reads. Instead we build one
 * document per genre+granularity at write time; the dashboard then reads one
 * doc per selected genre.
 *
 * Storage is COLUMNAR and packed into a single JSON string (`payload`): instead
 * of an array of per-app objects (which repeats every field/period key thousands
 * of times) we keep parallel arrays indexed by app. Packing them into one string
 * both shrinks the payload and — crucially — avoids Firestore's per-document
 * index-entry limit (every array element is auto-indexed; strings >1500 bytes are
 * not indexed at all). We only ever read this doc by id, so indexing is pure waste.
 *
 * Doc id: `${genreId}_${granularity}` in collection `genreAggregates`.
 * `months` holds the period keys (calendar months or ISO weeks) sorted ascending;
 * every per-app numeric array in the payload is index-aligned to it.
 */
export interface GenreAggregatePayload {
  ids: string[];
  names: string[];
  publishers: string[];
  ios: (string | null)[];
  android: (string | null)[];
  /** Flat row-major: rev[i * months.length + p]. */
  rev: number[];
  /** Flat row-major: dl[i * months.length + p]. */
  dl: number[];
}

export interface GenreAggregateDoc {
  genreId: string;
  granularity: Granularity;
  months: string[];
  /** JSON.stringify(GenreAggregatePayload) — see class doc for why it's a string. */
  payload: string;
  appCount: number;
  growingCount: number;
  trimmed: boolean;
  trimmedGrowing: boolean;
}

interface StoredAppData {
  unifiedAppId: string;
  unifiedAppName: string;
  publisherName?: string;
  iosAppId?: string | null;
  androidAppId?: string | null;
  downloads: number;
  storeRevenue: number;
}

function getDb(): Firestore {
  return getFirestore('companalysis');
}

/** Firestore hard-caps a document at 1 MiB; stay comfortably under it. */
const MAX_AGG_BYTES = 900_000;

/**
 * An app is "growing" (and thus protected from trimming) if its most recent
 * period grew at least this much on revenue or downloads. Matches the dashboard's
 * default Rising threshold (20%); any app the default filter would surface as
 * Rising 1/2/3 is retained regardless of its revenue rank.
 */
const GROWTH_THRESHOLD_PCT = 20;
/** Ignore "growth" on negligible apps so junk 0→$5 rows don't flood the doc. */
const NOISE_FLOOR_REVENUE = 100;
const NOISE_FLOOR_DOWNLOADS = 100;

function aggregateDocId(genreId: string, granularity: Granularity): string {
  return `${genreId}_${granularity}`;
}

/** Last-period growth %, using the same rules as the dashboard (0→positive = 100%). */
function lastPeriodGrowthPct(vals: number[]): number | null {
  if (vals.length < 2) return null;
  const prev = vals[vals.length - 2];
  const curr = vals[vals.length - 1];
  if (prev > 0) return ((curr - prev) / prev) * 100;
  if (curr > 0) return 100;
  return null;
}

/**
 * Rebuild the aggregate read-model doc for one genre + granularity from its
 * snapshots. Idempotent — safe to call repeatedly.
 */
export async function rebuildGenreAggregate(
  genre: { id: string; name?: string },
  granularity: Granularity,
  dbArg?: Firestore,
): Promise<{ appCount: number; months: string[]; trimmed: boolean; trimmedGrowing: boolean; growingCount: number }> {
  const db = dbArg ?? getDb();
  const timeField = granularity === 'week' ? 'week' : 'month';

  let q = db.collection('snapshots').where('genreId', '==', genre.id);
  if (granularity === 'week') {
    q = q.where('granularity', '==', 'week');
  }
  const snapsSnapshot = await q.orderBy(timeField, 'asc').get();

  const snaps = snapsSnapshot.docs.map((d) => ({
    ref: d.ref,
    period: d.data()[timeField] as string,
  }));

  const perPeriod = await Promise.all(
    snaps.map(async (s) => ({
      period: s.period,
      apps: (await s.ref.collection('apps').get()).docs.map((a) => a.data() as StoredAppData),
    })),
  );

  const months = snaps.map((s) => s.period);
  const aggRef = db.collection('genreAggregates').doc(aggregateDocId(genre.id, granularity));

  if (months.length === 0) {
    await aggRef.set(emptyDoc(genre.id, granularity));
    return { appCount: 0, months: [], trimmed: false, trimmedGrowing: false, growingCount: 0 };
  }

  const byPeriod = new Map<string, Map<string, StoredAppData>>();
  for (const { period, apps } of perPeriod) {
    const map = new Map<string, StoredAppData>();
    for (const app of apps) map.set(app.unifiedAppId, app);
    byPeriod.set(period, map);
  }

  // The dashboard shows apps present in the latest period, so key on those.
  const latestPeriod = months[months.length - 1];
  const latestApps = perPeriod.find((p) => p.period === latestPeriod)?.apps ?? [];

  // Materialize per-app columns + a "growing" flag and latest revenue for ranking.
  const cols = {
    ids: [] as string[],
    names: [] as string[],
    publishers: [] as string[],
    ios: [] as (string | null)[],
    android: [] as (string | null)[],
    rev: [] as number[][],
    dl: [] as number[][],
  };
  const latestRev: number[] = [];
  const growing: boolean[] = [];

  for (const app of latestApps) {
    const revArr: number[] = [];
    const dlArr: number[] = [];
    for (const period of months) {
      const found = byPeriod.get(period)!.get(app.unifiedAppId);
      revArr.push(found ? found.storeRevenue : 0);
      dlArr.push(found ? found.downloads : 0);
    }
    const lRev = revArr[revArr.length - 1];
    const lDl = dlArr[dlArr.length - 1];
    const meaningful = lRev >= NOISE_FLOOR_REVENUE || lDl >= NOISE_FLOOR_DOWNLOADS;
    const revGrow = lastPeriodGrowthPct(revArr);
    const dlGrow = lastPeriodGrowthPct(dlArr);
    const isGrowing =
      meaningful &&
      ((revGrow !== null && revGrow >= GROWTH_THRESHOLD_PCT) ||
        (dlGrow !== null && dlGrow >= GROWTH_THRESHOLD_PCT));

    cols.ids.push(app.unifiedAppId);
    cols.names.push(app.unifiedAppName);
    cols.publishers.push(app.publisherName || '');
    cols.ios.push(app.iosAppId ?? null);
    cols.android.push(app.androidAppId ?? null);
    cols.rev.push(revArr);
    cols.dl.push(dlArr);
    latestRev.push(lRev);
    growing.push(isGrowing);
  }

  const growingCount = growing.filter(Boolean).length;

  // Rank by latest revenue desc; split into protected (growing) and the rest.
  const byRevDesc = [...latestApps.keys()].sort((a, b) => latestRev[b] - latestRev[a]);
  const protectedIdx = byRevDesc.filter((i) => growing[i]);
  const nonProtIdx = byRevDesc.filter((i) => !growing[i]);

  const P = months.length;
  const buildPayload = (indices: number[]): string => {
    const revFlat: number[] = [];
    const dlFlat: number[] = [];
    for (const i of indices) {
      const r = cols.rev[i];
      const d = cols.dl[i];
      for (let p = 0; p < P; p++) {
        revFlat.push(r[p] ?? 0);
        dlFlat.push(d[p] ?? 0);
      }
    }
    const payload: GenreAggregatePayload = {
      ids: indices.map((i) => cols.ids[i]),
      names: indices.map((i) => cols.names[i]),
      publishers: indices.map((i) => cols.publishers[i]),
      ios: indices.map((i) => cols.ios[i]),
      android: indices.map((i) => cols.android[i]),
      rev: revFlat,
      dl: dlFlat,
    };
    return JSON.stringify(payload);
  };
  const sizeOf = (indices: number[]): number => Buffer.byteLength(buildPayload(indices));

  // Keep all protected growers, then fill remaining budget with top-revenue apps.
  let keepNon = nonProtIdx.length;
  let selected: number[] = [...protectedIdx, ...nonProtIdx];
  while (keepNon >= 0) {
    selected = [...protectedIdx, ...nonProtIdx.slice(0, keepNon)];
    if (sizeOf(selected) <= MAX_AGG_BYTES || keepNon === 0) break;
    keepNon = Math.max(0, keepNon - Math.max(1, Math.floor(keepNon * 0.05)));
  }
  let trimmed = keepNon < nonProtIdx.length;
  let trimmedGrowing = false;

  // Pathological: growers alone exceed the limit. Trim them by revenue too.
  if (sizeOf(selected) > MAX_AGG_BYTES) {
    trimmedGrowing = true;
    let keepProt = protectedIdx.length;
    while (keepProt > 0) {
      selected = protectedIdx.slice(0, keepProt);
      if (sizeOf(selected) <= MAX_AGG_BYTES) break;
      keepProt = Math.max(0, keepProt - Math.max(1, Math.floor(keepProt * 0.05)));
    }
    trimmed = true;
    console.error(
      `rebuildGenreAggregate: ${genre.name ?? genre.id} (${granularity}) has more growing apps ` +
        `than fit 1MiB — trimmed growers to ${keepProt}. Consider sharding this genre.`,
    );
  }

  // Store in revenue order (client re-sorts anyway, but this is a sensible default).
  selected.sort((a, b) => latestRev[b] - latestRev[a]);

  if (trimmed) {
    console.warn(
      `rebuildGenreAggregate: ${genre.name ?? genre.id} (${granularity}) kept ${selected.length}` +
        ` of ${latestApps.length} apps (${growingCount} growing, all retained${trimmedGrowing ? ' — EXCEPT some growers' : ''}).`,
    );
  }

  await aggRef.set({
    genreId: genre.id,
    granularity,
    months,
    payload: buildPayload(selected),
    appCount: selected.length,
    growingCount,
    trimmed,
    trimmedGrowing,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { appCount: selected.length, months, trimmed, trimmedGrowing, growingCount };
}

function emptyDoc(genreId: string, granularity: Granularity) {
  const payload: GenreAggregatePayload = {
    ids: [], names: [], publishers: [], ios: [], android: [], rev: [], dl: [],
  };
  return {
    genreId,
    granularity,
    months: [] as string[],
    payload: JSON.stringify(payload),
    appCount: 0,
    growingCount: 0,
    trimmed: false,
    trimmedGrowing: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/** Delete both granularities' aggregate docs for a genre (used on genre delete). */
export async function deleteGenreAggregates(genreId: string, dbArg?: Firestore): Promise<void> {
  const db = dbArg ?? getDb();
  await Promise.all([
    db.collection('genreAggregates').doc(aggregateDocId(genreId, 'month')).delete(),
    db.collection('genreAggregates').doc(aggregateDocId(genreId, 'week')).delete(),
  ]);
}
