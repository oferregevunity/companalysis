import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGenres } from '../hooks/useGenres';
import { useCreativeInsights } from '../hooks/useCreativeInsights';
import { useCreativesForGenre } from '../hooks/useCreativesForGenre';
import { useGenreDataStatus } from '../hooks/useGenreDataStatus';
import { useApiCompetitors } from '../hooks/useApiCompetitors';
import { getCreativeWeekBounds, getLatestCreativeWeek } from '../lib/creativesWeek';
import { fetchCreativesForApp, triggerCreativesForGenre, type SearchedGame } from '../lib/creativesApi';
import { matchGenresForGame } from '../lib/gameGenres';
import { AIHighlightsStrip } from '../components/creatives/AIHighlightsStrip';
import { CreativeGallery } from '../components/creatives/CreativeGallery';
import { GameSearch } from '../components/creatives/GameSearch';
import { CompetitorStrip, type CompetitorApp } from '../components/creatives/CompetitorStrip';
import { HookThemePanel } from '../components/creatives/HookThemePanel';
import {
  buildAppOptions,
  CreativeFilters,
  defaultFilters,
  type Filters,
} from '../components/creatives/CreativeFilters';
import { CreativeDetailModal } from '../components/creatives/CreativeDetailModal';
import { useAppNames, type AppNameMapEntry } from '../hooks/useAppNames';
import type { CreativeFormat, CreativeTag, QueryableAdNetwork } from '../types/creatives';
import type { JoinedCreative } from '../hooks/useCreativesForGenre';

const STORAGE_KEY = 'creatives.selectedGenreId';
// Full SearchedGame JSON — the focused game comes from live Sensor Tower
// search and may not exist anywhere in our own DB.
const FOCUS_APP_KEY = 'creatives.focusApp';

function loadStoredFocusApp(): SearchedGame | null {
  try {
    const raw = localStorage.getItem(FOCUS_APP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SearchedGame;
    if (!parsed || typeof parsed.appId !== 'string' || typeof parsed.name !== 'string') return null;
    return {
      ...parsed,
      iosCategories: Array.isArray(parsed.iosCategories) ? parsed.iosCategories : [],
      androidCategories: Array.isArray(parsed.androidCategories) ? parsed.androidCategories : [],
    };
  } catch {
    return null;
  }
}

function generatedAtToDate(
  v: { seconds: number; nanoseconds: number } | Date | { toDate: () => Date } | undefined | null,
): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'object' && 'seconds' in v) {
    return new Date((v as { seconds: number }).seconds * 1000);
  }
  return null;
}

function formatTimeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatRelativeOrDash(d: Date | null | undefined): string {
  if (d == null) return '—';
  return formatTimeAgo(d);
}

function parseSeenMs(s: string): number | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Filters by AI hook/theme tags; creatives without a tag never match an active tag filter. */
function applyTagFilters(
  list: JoinedCreative[],
  filters: Pick<Filters, 'hookTypes' | 'themes'>,
  tagMap: Map<string, CreativeTag>,
): JoinedCreative[] {
  if (filters.hookTypes.size === 0 && filters.themes.size === 0) return list;
  return list.filter((c) => {
    const tag = tagMap.get(c.docId);
    if (!tag) return false;
    if (filters.hookTypes.size > 0 && !filters.hookTypes.has(tag.hookType)) return false;
    if (filters.themes.size > 0 && !tag.themes.some((t) => filters.themes.has(t.trim().toLowerCase()))) return false;
    return true;
  });
}

function applyCreativeFilters(
  list: JoinedCreative[],
  filters: Filters,
  appNames: Map<string, AppNameMapEntry>,
): JoinedCreative[] {
  const q = filters.search.trim().toLowerCase();
  let out = list;

  if (q) {
    out = out.filter((c) => {
      const app = appNames.get(c.appId);
      const name = (app?.name ?? '').toLowerCase();
      const pub = (app?.publisherName ?? '').toLowerCase();
      const title = (c.title ?? '').toLowerCase();
      return name.includes(q) || pub.includes(q) || title.includes(q);
    });
  }

  if (filters.networks.size > 0) {
    out = out.filter((c) => c.networks.some((n) => filters.networks.has(n)));
  }

  if (filters.formats.size > 0) {
    out = out.filter((c) => filters.formats.has(c.format));
  }

  if (filters.appIds.size > 0) {
    out = out.filter((c) => filters.appIds.has(c.appId));
  }

  if (filters.newThisWeek) {
    out = out.filter((c) => {
      const t = parseSeenMs(c.firstSeen);
      if (t === null) return false;
      return t >= Date.now() - 7 * 86400000;
    });
  }

  if (filters.winnersOnly) {
    out = out.filter((c) => c.score != null && c.score >= 60);
  }

  const scoreVal = (c: JoinedCreative) => c.score ?? Number.NEGATIVE_INFINITY;
  const sovVal = (c: JoinedCreative) => c.maxShare ?? Number.NEGATIVE_INFINITY;
  const firstSeenVal = (c: JoinedCreative) => parseSeenMs(c.firstSeen) ?? Number.NEGATIVE_INFINITY;

  const sorted = [...out];
  sorted.sort((a, b) => {
    switch (filters.sort) {
      case 'score':
        return scoreVal(b) - scoreVal(a);
      case 'duration':
        return b.durationDays - a.durationDays;
      case 'firstSeen':
        return firstSeenVal(b) - firstSeenVal(a);
      case 'sov':
        return sovVal(b) - sovVal(a);
      default:
        return 0;
    }
  });

  return sorted;
}

export default function Creatives() {
  const { genres, loading: genresLoading } = useGenres();
  const [selectedGenreId, setSelectedGenreId] = useState<string>('');
  const [focusApp, setFocusApp] = useState<SearchedGame | null>(() => loadStoredFocusApp());
  const [generating, setGenerating] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [reanalyzeSuccess, setReanalyzeSuccess] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const latestWeek = useMemo(() => getLatestCreativeWeek(), []);

  /** Tracked genres the focused game belongs to, matched by store category. */
  const matchedGenreIds = useMemo(
    () => (focusApp ? matchGenresForGame(focusApp, genres).map((g) => g.id) : []),
    [focusApp, genres],
  );

  useEffect(() => {
    if (genres.length === 0) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && genres.some((g) => g.id === stored)) {
        setSelectedGenreId(stored);
        return;
      }
    } catch {
      /* ignore */
    }
    setSelectedGenreId(genres[0].id);
  }, [genres]);

  const selectGenre = useCallback(
    (id: string) => {
      setSelectedGenreId(id);
      setReanalyzeError(null);
      setReanalyzeSuccess(null);
      setFilters((prev) => ({ ...prev, appIds: new Set(), hookTypes: new Set(), themes: new Set() }));
      // Manually browsing to a genre the focused game isn't in drops the focus.
      if (focusApp && !matchedGenreIds.includes(id)) {
        setFocusApp(null);
        try {
          localStorage.removeItem(FOCUS_APP_KEY);
        } catch {
          /* ignore */
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
    },
    [focusApp, matchedGenreIds],
  );

  const selectFocusApp = useCallback(
    (app: SearchedGame) => {
      setFocusApp(app);
      try {
        localStorage.setItem(FOCUS_APP_KEY, JSON.stringify(app));
      } catch {
        /* ignore */
      }
      // Pivot the page to the game's genre (keep the current one when it applies).
      setFilters((prev) => ({ ...prev, appIds: new Set(), hookTypes: new Set(), themes: new Set() }));
      const appGenreIds = matchGenresForGame(app, genres).map((g) => g.id);
      setSelectedGenreId((cur) => {
        const next = appGenreIds.includes(cur) ? cur : appGenreIds[0] ?? cur;
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [genres],
  );

  const clearFocusApp = useCallback(() => {
    setFocusApp(null);
    setFilters((prev) => ({ ...prev, appIds: new Set() }));
    try {
      localStorage.removeItem(FOCUS_APP_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const { data: insightDoc, loading: insightLoading } = useCreativeInsights(selectedGenreId, latestWeek);
  const {
    creatives: joinedCreatives,
    loading: creativesLoading,
    refresh: refreshCreatives,
  } = useCreativesForGenre(selectedGenreId, latestWeek);
  const { statusMap: genreStatusMap } = useGenreDataStatus(selectedGenreId ? [selectedGenreId] : []);
  const creativesRunStatus = selectedGenreId ? genreStatusMap[selectedGenreId]?.creatives : undefined;

  const rankMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!insightDoc?.winners) return m;
    for (const w of insightDoc.winners) {
      if (w.rank <= 10) {
        m.set(w.creativeId, w.rank);
      }
    }
    return m;
  }, [insightDoc]);

  // Auto-fetch creatives for the focused game when it has none this week
  // (it was outside the top-N fetch scope). One attempt per app+genre+week.
  const [appFetch, setAppFetch] = useState<
    | { status: 'fetching'; appId: string; appName: string }
    | { status: 'done'; appId: string; appName: string; count: number }
    | { status: 'error'; appId: string; appName: string; message: string }
    | null
  >(null);
  const appFetchAttemptsRef = useRef<Set<string>>(new Set());

  const runAppFetch = useCallback(
    (appId: string, appName: string, genreId: string) => {
      void (async () => {
        setAppFetch({ status: 'fetching', appId, appName });
        try {
          const { startDate, endDate } = getCreativeWeekBounds(latestWeek);
          const result = await fetchCreativesForApp(appId, genreId, startDate, endDate);
          setAppFetch({ status: 'done', appId, appName, count: result.creativeCount });
          if (result.creativeCount > 0) refreshCreatives();
        } catch (err) {
          setAppFetch({
            status: 'error',
            appId,
            appName,
            message: err instanceof Error ? err.message : 'Fetch failed.',
          });
        }
      })();
    },
    [latestWeek, refreshCreatives],
  );

  useEffect(() => {
    if (!focusApp || !selectedGenreId || creativesLoading) return;
    if (!matchedGenreIds.includes(selectedGenreId)) return;
    if (joinedCreatives.some((c) => c.appId === focusApp.appId)) return;
    const attemptKey = `${focusApp.appId}|${selectedGenreId}|${latestWeek}`;
    if (appFetchAttemptsRef.current.has(attemptKey)) return;
    appFetchAttemptsRef.current.add(attemptKey);
    runAppFetch(focusApp.appId, focusApp.name, selectedGenreId);
  }, [focusApp, matchedGenreIds, selectedGenreId, creativesLoading, joinedCreatives, latestWeek, runAppFetch]);

  const tagMap = useMemo(() => {
    const m = new Map<string, CreativeTag>();
    for (const t of insightDoc?.creativeTags ?? []) {
      m.set(t.creativeId, t);
    }
    return m;
  }, [insightDoc]);

  // Competitors: fetched live from the Sensor Tower API — top revenue apps in
  // the focused game's category (not from our stored snapshots).
  const selectedGenre = useMemo(
    () => genres.find((g) => g.id === selectedGenreId) ?? null,
    [genres, selectedGenreId],
  );
  const competitorCategory = useMemo(() => {
    if (!focusApp) return null;
    // Stay aligned with the page's genre when the game belongs to it, so the
    // competitor rail and the creatives gallery talk about the same arena.
    if (selectedGenre && matchedGenreIds.includes(selectedGenre.id)) {
      return selectedGenre.categoryIds.ios || selectedGenre.categoryIds.android.toLowerCase() || null;
    }
    return (
      focusApp.gameCategory ||
      focusApp.iosCategories[0] ||
      focusApp.androidCategories[0]?.toLowerCase() ||
      null
    );
  }, [focusApp, selectedGenre, matchedGenreIds]);
  const competitorCountry =
    selectedGenre && matchedGenreIds.includes(selectedGenre.id) ? selectedGenre.country : 'US';

  const {
    competitors: apiCompetitors,
    focusRow,
    loading: competitorsLoading,
    error: competitorsError,
  } = useApiCompetitors(competitorCategory, competitorCountry, focusApp?.appId ?? null);

  const competitors = useMemo<CompetitorApp[]>(
    () =>
      apiCompetitors.map((c) => ({
        appId: c.appId,
        name: c.name,
        publisherName: c.publisherName,
        latestRevenue: c.revenue,
        iconUrl: c.iconUrl,
      })),
    [apiCompetitors],
  );

  const focusStripApp = useMemo<CompetitorApp | null>(
    () =>
      focusApp
        ? {
            appId: focusApp.appId,
            name: focusApp.name,
            publisherName: focusApp.publisherName,
            latestRevenue: focusRow?.revenue ?? null,
            iconUrl: focusApp.iconUrl,
          }
        : null,
    [focusApp, focusRow],
  );

  const appIds = useMemo(() => {
    const ids = joinedCreatives.map((c) => c.appId);
    if (focusApp) {
      ids.push(focusApp.appId);
      for (const c of competitors.slice(0, 16)) ids.push(c.appId);
    }
    return ids;
  }, [joinedCreatives, focusApp, competitors]);
  const appNames = useAppNames(appIds);

  const availableNetworks = useMemo(() => {
    const s = new Set<QueryableAdNetwork>();
    for (const c of joinedCreatives) {
      for (const n of c.networks) {
        s.add(n);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [joinedCreatives]);

  const availableFormats = useMemo(() => {
    const s = new Set<CreativeFormat>();
    for (const c of joinedCreatives) {
      s.add(c.format);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [joinedCreatives]);

  const appOptions = useMemo(
    () => buildAppOptions([...new Set(joinedCreatives.map((c) => c.appId))], appNames),
    [joinedCreatives, appNames],
  );

  /** Everything except hook/theme filters — feeds the Hooks & themes panel so its counts stay stable. */
  const baseFilteredCreatives = useMemo(
    () => applyCreativeFilters(joinedCreatives, filters, appNames),
    [joinedCreatives, filters, appNames],
  );

  const filteredCreatives = useMemo(
    () => applyTagFilters(baseFilteredCreatives, filters, tagMap),
    [baseFilteredCreatives, filters, tagMap],
  );

  const toggleAppFilter = useCallback((appId: string) => {
    setFilters((prev) => {
      const next = new Set(prev.appIds);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return { ...prev, appIds: next };
    });
  }, []);

  const toggleHookType = useCallback((hook: string) => {
    setFilters((prev) => {
      const next = new Set(prev.hookTypes);
      if (next.has(hook)) next.delete(hook);
      else next.add(hook);
      return { ...prev, hookTypes: next };
    });
  }, []);

  const toggleTheme = useCallback((theme: string) => {
    setFilters((prev) => {
      const next = new Set(prev.themes);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return { ...prev, themes: next };
    });
  }, []);

  const detailCreative = useMemo(
    () => (detailDocId ? joinedCreatives.find((c) => c.docId === detailDocId) ?? null : null),
    [joinedCreatives, detailDocId],
  );

  useEffect(() => {
    if (detailDocId && !detailCreative) {
      setDetailDocId(null);
    }
  }, [detailDocId, detailCreative]);

  const lastAnalyzed = useMemo(() => {
    const d = generatedAtToDate(insightDoc?.generatedAt);
    if (!d) return null;
    return formatTimeAgo(d);
  }, [insightDoc?.generatedAt]);

  const onScrollToCreative = useCallback((docId: string) => {
    document.getElementById(`creative-${docId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const handleReanalyze = useCallback(async () => {
    if (!selectedGenreId) return;
    setReanalyzeError(null);
    setReanalyzeSuccess(null);
    setGenerating(true);
    try {
      const { startDate, endDate } = getCreativeWeekBounds(latestWeek);
      const result = await triggerCreativesForGenre(selectedGenreId, startDate, endDate);
      if (!result.success) {
        const detail =
          result.partialErrors?.length > 0 ? result.partialErrors.join(' · ') : 'Pipeline finished with issues.';
        setReanalyzeError(detail);
      } else {
        setReanalyzeSuccess('Analysis completed. The view will refresh as Firestore updates.');
      }
    } catch (err) {
      console.error('triggerCreativesForGenre', err);
      setReanalyzeError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setGenerating(false);
    }
  }, [selectedGenreId, latestWeek]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Creatives</h1>
          <p className="mt-1 text-xs text-gray-500">
            <span className="font-medium text-gray-600">Creatives:</span>{' '}
            fetched {formatRelativeOrDash(creativesRunStatus?.lastFetchedAt ?? null)} · analyzed{' '}
            {formatRelativeOrDash(creativesRunStatus?.lastAnalyzedAt ?? null)} · errored{' '}
            {formatRelativeOrDash(creativesRunStatus?.lastErroredAt ?? null)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="text-sm text-gray-500 text-right">
              {insightLoading && !insightDoc ? (
                <span>Loading status…</span>
              ) : lastAnalyzed ? (
                <span>Last analyzed {lastAnalyzed}</span>
              ) : (
                <span>Never analyzed.</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={generating || !selectedGenreId}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {generating ? 'Re-analyzing…' : 'Re-analyze this week'}
            </button>
          </div>
          {generating && (
            <p className="text-xs text-gray-500 text-right max-w-sm">
              Re-analyzing… this takes ~1–2 minutes.
            </p>
          )}
          {reanalyzeError && !generating && (
            <p className="text-xs text-red-600 text-right max-w-sm">{reanalyzeError}</p>
          )}
          {reanalyzeSuccess && !generating && !reanalyzeError && (
            <p className="text-xs text-green-700 text-right max-w-sm">{reanalyzeSuccess}</p>
          )}
        </div>
      </div>

      <GameSearch
        genres={genres}
        focusApp={focusApp}
        onSelect={selectFocusApp}
        onClear={clearFocusApp}
      />

      <div className="flex flex-wrap items-center gap-2">
        {!genresLoading && genres.length > 0 && (
          <span className="text-xs font-medium text-gray-400 mr-1">
            {focusApp ? 'Genre' : 'Or browse by genre'}
          </span>
        )}
        {genresLoading ? (
          <span className="text-sm text-gray-400">Loading genres…</span>
        ) : (
          genres.map((genre) => (
            <button
              key={genre.id}
              type="button"
              onClick={() => selectGenre(genre.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedGenreId === genre.id
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {genre.name}
            </button>
          ))
        )}
      </div>

      {appFetch && focusApp && appFetch.appId === focusApp.appId && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            appFetch.status === 'fetching'
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : appFetch.status === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {appFetch.status === 'fetching' && (
            <>
              <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
              <span>
                Fetching this week's creatives for <span className="font-semibold">{appFetch.appName}</span>… usually
                under a minute.
              </span>
            </>
          )}
          {appFetch.status === 'done' && (
            <span>
              {appFetch.count > 0
                ? `Fetched ${appFetch.count} creative${appFetch.count === 1 ? '' : 's'} for ${appFetch.appName} and added it to the team watchlist.`
                : `No creatives found for ${appFetch.appName} this week — it's now on the team watchlist for future fetches.`}
            </span>
          )}
          {appFetch.status === 'error' && (
            <span>
              Could not fetch creatives for {appFetch.appName}: {appFetch.message}{' '}
              <button
                type="button"
                onClick={() => runAppFetch(appFetch.appId, appFetch.appName, selectedGenreId)}
                className="font-semibold underline hover:no-underline"
              >
                Retry
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={() => setAppFetch(null)}
            className="ml-auto shrink-0 rounded-full p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {focusStripApp && (
        <CompetitorStrip
          focusApp={focusStripApp}
          competitors={competitors}
          loading={competitorsLoading}
          error={competitorsError}
          creatives={joinedCreatives}
          appNames={appNames}
          selectedAppIds={filters.appIds}
          onToggleApp={toggleAppFilter}
          onShowAll={() => setFilters((prev) => ({ ...prev, appIds: new Set() }))}
        />
      )}

      <AIHighlightsStrip
        insightDoc={insightDoc}
        joinedCreatives={joinedCreatives}
        loading={insightLoading}
        onScrollToCreative={onScrollToCreative}
      />

      <HookThemePanel
        tagMap={tagMap}
        creatives={baseFilteredCreatives}
        selectedHookTypes={filters.hookTypes}
        selectedThemes={filters.themes}
        onToggleHookType={toggleHookType}
        onToggleTheme={toggleTheme}
        hasInsightDoc={insightDoc != null}
      />

      {creativesLoading ? (
        <div className="text-center py-12 text-gray-400">Loading creatives…</div>
      ) : joinedCreatives.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No creatives for this genre yet.</div>
      ) : (
        <>
          <CreativeFilters
            filters={filters}
            setFilters={setFilters}
            availableNetworks={availableNetworks}
            availableFormats={availableFormats}
            appOptions={appOptions}
          />
          {filteredCreatives.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No creatives match your filters.</div>
          ) : (
            <CreativeGallery
              creatives={filteredCreatives}
              rankMap={rankMap}
              appNames={appNames}
              tagMap={tagMap}
              onOpen={setDetailDocId}
            />
          )}
        </>
      )}

      <CreativeDetailModal
        open={detailDocId != null}
        onClose={() => setDetailDocId(null)}
        creative={detailCreative}
        insightDoc={insightDoc}
        appEntry={detailCreative ? appNames.get(detailCreative.appId) : undefined}
      />
    </div>
  );
}
