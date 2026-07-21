/**
 * Country + OS "market opportunity" for a game workspace. This is MARKET data
 * (store revenue/downloads), NOT creative data — Sensor Tower unified ad-intel
 * has no OS split, and true first-party country/OS performance lives in
 * AppsFlyer. We reuse `fetchTopApps` (category × country × os) and locate the
 * focus game + competitors within each top list to surface markets where
 * competitors are strong and the focus game is weak or absent.
 */

/** One app descriptor the caller wants presence for. Store ids are needed for the OS split. */
export interface MarketApp {
  /** Unified Sensor Tower app id (matches `os='unified'` rows). */
  appId: string;
  iosAppId: string | null;
  androidAppId: string | null;
  isFocus: boolean;
}

/** A per-app revenue/downloads row as returned by `fetchTopApps`. */
export interface AppMarketRow {
  appId: string;
  revenue: number;
  downloads: number;
}

export interface CountryPresence {
  country: string;
  competitorRevenue: number;
  competitorDownloads: number;
  focusRevenue: number;
  focusDownloads: number;
  /** focusRevenue / (focusRevenue + competitorRevenue); 0 when no revenue seen. */
  focusShare: number;
  /** How many competitor apps ranked in this country's top list. */
  competitorGames: number;
  topCompetitors: Array<{ appId: string; revenue: number }>;
}

export interface OsPresence {
  os: 'ios' | 'android';
  competitorRevenue: number;
  competitorDownloads: number;
  focusRevenue: number;
  focusDownloads: number;
  focusShare: number;
  competitorGames: number;
}

export interface MarketPresence {
  month: string;
  primaryCountry: string;
  byCountry: CountryPresence[];
  byOs: OsPresence[];
}

/** Default market set — big monetizing markets across regions. */
export const DEFAULT_MARKET_COUNTRIES = ['US', 'JP', 'KR', 'DE', 'GB', 'FR', 'BR', 'CA', 'AU', 'TW'] as const;

function share(focus: number, competitor: number): number {
  const total = focus + competitor;
  return total > 0 ? Math.round((focus / total) * 1000) / 1000 : 0;
}

/**
 * Build a country presence row from a lookup that resolves each app to its
 * revenue/downloads in that country (undefined = not in the top list). Pure —
 * unit-testable without any network calls.
 */
export function buildCountryPresence(
  country: string,
  apps: MarketApp[],
  getRow: (app: MarketApp) => AppMarketRow | undefined,
): CountryPresence {
  let competitorRevenue = 0;
  let competitorDownloads = 0;
  let focusRevenue = 0;
  let focusDownloads = 0;
  const competitors: Array<{ appId: string; revenue: number }> = [];

  for (const app of apps) {
    const row = getRow(app);
    if (!row) continue;
    if (app.isFocus) {
      focusRevenue += row.revenue;
      focusDownloads += row.downloads;
    } else {
      competitorRevenue += row.revenue;
      competitorDownloads += row.downloads;
      competitors.push({ appId: app.appId, revenue: row.revenue });
    }
  }

  competitors.sort((a, b) => b.revenue - a.revenue);

  return {
    country,
    competitorRevenue,
    competitorDownloads,
    focusRevenue,
    focusDownloads,
    focusShare: share(focusRevenue, competitorRevenue),
    competitorGames: competitors.length,
    topCompetitors: competitors.slice(0, 5),
  };
}

/** Same as `buildCountryPresence` but for a single OS split. */
export function buildOsPresence(
  os: 'ios' | 'android',
  apps: MarketApp[],
  getRow: (app: MarketApp) => AppMarketRow | undefined,
): OsPresence {
  const c = buildCountryPresence(os, apps, getRow);
  return {
    os,
    competitorRevenue: c.competitorRevenue,
    competitorDownloads: c.competitorDownloads,
    focusRevenue: c.focusRevenue,
    focusDownloads: c.focusDownloads,
    focusShare: c.focusShare,
    competitorGames: c.competitorGames,
  };
}

export interface MarketPresenceDeps {
  apps: MarketApp[];
  category: string;
  countries: readonly string[];
  primaryCountry: string;
  month: string;
  /** Which OS splits to compute. Callers omit `android` when there's no android category. */
  osList?: ReadonlyArray<'ios' | 'android'>;
  /** Fetch top apps for a scope, returning per-app revenue/downloads rows. */
  fetchTop: (os: 'unified' | 'ios' | 'android', country: string) => Promise<AppMarketRow[]>;
}

/**
 * Orchestrates the per-country (unified) and per-OS (primary country) lookups
 * and reduces them into a `MarketPresence`. Country rows sort by competitor
 * revenue descending so the biggest opportunities float to the top.
 */
export async function fetchMarketPresenceWithDeps(deps: MarketPresenceDeps): Promise<MarketPresence> {
  const { apps, countries, primaryCountry, month, fetchTop } = deps;
  const osList = deps.osList ?? (['ios', 'android'] as const);

  const byCountry: CountryPresence[] = [];
  for (const country of countries) {
    const rows = await fetchTop('unified', country);
    const byId = new Map(rows.map((r) => [r.appId, r]));
    byCountry.push(buildCountryPresence(country, apps, (app) => byId.get(app.appId)));
  }
  byCountry.sort((a, b) => b.competitorRevenue - a.competitorRevenue);

  const byOs: OsPresence[] = [];
  for (const os of osList) {
    const rows = await fetchTop(os, primaryCountry);
    const byId = new Map(rows.map((r) => [r.appId, r]));
    byOs.push(
      buildOsPresence(os, apps, (app) => {
        const storeId = os === 'ios' ? app.iosAppId : app.androidAppId;
        return storeId ? byId.get(storeId) : undefined;
      }),
    );
  }

  return { month, primaryCountry, byCountry, byOs };
}

/**
 * Firestore-bound entry: reuses `fetchTopApps` + `lastCompleteMonthRange`,
 * persists the result onto the shared workspace doc, and returns it.
 */
export async function fetchMarketPresence(params: {
  focusAppId: string;
  apps: MarketApp[];
  /** Unified/iOS category id (iOS numeric) — accepted by the unified + iOS top-apps endpoints. */
  category: string;
  /** Android category slug (e.g. "GAME_STRATEGY"); when absent, the Android OS split is skipped. */
  androidCategory?: string | null;
  primaryCountry: string;
  countries?: readonly string[];
  authToken: string;
}): Promise<MarketPresence> {
  const [{ getFirestore, FieldValue }, { fetchTopApps }, { lastCompleteMonthRange }] = await Promise.all([
    import('firebase-admin/firestore'),
    import('../sensorTower/client'),
    import('../sensorTower/competitors'),
  ]);

  const { startDate, endDate } = lastCompleteMonthRange();
  const month = startDate.slice(0, 7);
  const countries = params.countries ?? DEFAULT_MARKET_COUNTRIES;
  const androidCategory = params.androidCategory ?? null;
  // Android top-apps needs an Android category slug; skip that split if we don't have one.
  const osList: Array<'ios' | 'android'> = androidCategory ? ['ios', 'android'] : ['ios'];

  const presence = await fetchMarketPresenceWithDeps({
    apps: params.apps,
    category: params.category,
    countries,
    primaryCountry: params.primaryCountry,
    month,
    osList,
    fetchTop: async (os, country) => {
      const rows = await fetchTopApps({
        authToken: params.authToken,
        os,
        // The Android endpoint needs the Android slug; unified/iOS use the iOS numeric id.
        category: os === 'android' && androidCategory ? androidCategory : params.category,
        country,
        startDate,
        endDate,
        limit: 500,
      });
      return rows.map((r) => ({ appId: r.appId, revenue: r.revenue, downloads: r.downloads }));
    },
  });

  const db = getFirestore('companalysis');
  await db.collection('gameWorkspaces').doc(params.focusAppId).set(
    { marketPresence: { ...presence, generatedAt: FieldValue.serverTimestamp() } },
    { merge: true },
  );

  return presence;
}
