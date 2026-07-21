import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCreativeInsights } from '../hooks/useCreativeInsights';
import { useCreativesForApps } from '../hooks/useCreativesForGenre';
import { useGameWorkspace, useRecentWorkspaces, type GameWorkspace } from '../hooks/useGameWorkspace';
import { useWorkspaceAnalysis } from '../hooks/useWorkspaceAnalysis';
import { getLatestCreativeWeek } from '../lib/creativesWeek';
import {
  discoverCompetitors,
  type DiscoveredCompetitor,
  type SearchedGame,
} from '../lib/creativesApi';
import { AIHighlightsStrip } from '../components/creatives/AIHighlightsStrip';
import { CreativeGallery } from '../components/creatives/CreativeGallery';
import { GameSearch } from '../components/creatives/GameSearch';
import { CompetitorRail } from '../components/creatives/CompetitorRail';
import { HookThemePanel } from '../components/creatives/HookThemePanel';
import { FormatGapPanel } from '../components/creatives/FormatGapPanel';
import { OpportunityPanel } from '../components/creatives/OpportunityPanel';
import { MarketPulsePanel } from '../components/creatives/MarketPulsePanel';
import { durationBucket } from '../lib/creativeBuckets';
import type { MarketApp } from '../lib/creativesApi';
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

// Full SearchedGame JSON — the focused game comes from live Sensor Tower
// search and may not exist anywhere in our own DB.
const FOCUS_APP_KEY = 'creatives.focusApp';
const DEFAULT_SELECTED = 10;

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

function formatTimeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function generatedAtToDate(
  v: { seconds: number; nanoseconds: number } | Date | { toDate: () => Date } | undefined | null,
): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'object' && 'seconds' in v) {
    return new Date((v as { seconds: number }).seconds * 1000);
  }
  return null;
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

  if (filters.durationBuckets.size > 0) {
    out = out.filter((c) => c.format === 'video' && filters.durationBuckets.has(durationBucket(c.videoDurationSec)));
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

function RecentGamesRow({ onSelect }: { onSelect: (game: SearchedGame) => void }) {
  const recent = useRecentWorkspaces();
  if (recent.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-gray-400">Recent games</span>
      {recent.map((r) => (
        <button
          key={r.focusApp.appId}
          type="button"
          onClick={() => onSelect(r.focusApp)}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50"
        >
          {r.focusApp.iconUrl && <img src={r.focusApp.iconUrl} alt="" className="w-4 h-4 rounded" />}
          {r.focusApp.name}
          {r.updatedAt && <span className="text-[10px] text-gray-400">{formatTimeAgo(r.updatedAt)}</span>}
        </button>
      ))}
    </div>
  );
}

export default function Creatives() {
  const [focusApp, setFocusApp] = useState<SearchedGame | null>(() => loadStoredFocusApp());
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const latestWeek = useMemo(() => getLatestCreativeWeek(), []);
  const scopeId = focusApp ? `game_${focusApp.appId}` : '';

  const { workspace, loaded: workspaceLoaded, save } = useGameWorkspace(focusApp?.appId ?? null);

  // Curation state, hydrated from the workspace doc or fresh discovery.
  const [competitors, setCompetitors] = useState<DiscoveredCompetitor[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [country, setCountry] = useState('US');
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const hydratedForRef = useRef<string | null>(null);

  const persistWorkspace = useCallback(
    (partial: Partial<GameWorkspace>) => {
      if (!focusApp) return;
      const ws: GameWorkspace = {
        focusApp,
        competitors,
        selectedIds: [...selectedIds],
        country,
        lastAnalyzedWeek: workspace?.lastAnalyzedWeek ?? null,
        ...partial,
      };
      void save(ws).catch((err) => console.error('workspace save failed', err));
    },
    [focusApp, competitors, selectedIds, country, workspace, save],
  );

  const runDiscovery = useCallback(
    (game: SearchedGame, ctry: string) => {
      setDiscovering(true);
      setDiscoveryError(null);
      void (async () => {
        try {
          const { competitors: found } = await discoverCompetitors(game, ctry);
          setCompetitors(found);
          const selected = found.slice(0, DEFAULT_SELECTED).map((c) => c.appId);
          setSelectedIds(new Set(selected));
          // First save creates the shared workspace doc.
          void save({
            focusApp: game,
            competitors: found,
            selectedIds: selected,
            country: ctry,
            lastAnalyzedWeek: null,
          }).catch((err) => console.error('workspace save failed', err));
        } catch (err) {
          setDiscoveryError(err instanceof Error ? err.message : 'Discovery failed.');
        } finally {
          setDiscovering(false);
        }
      })();
    },
    [save],
  );

  // Hydrate curation state once per focused game: from the stored workspace
  // when it exists, otherwise via AI discovery.
  useEffect(() => {
    if (!focusApp || !workspaceLoaded) return;
    if (hydratedForRef.current === focusApp.appId) return;
    hydratedForRef.current = focusApp.appId;
    if (workspace) {
      setCompetitors(workspace.competitors);
      setSelectedIds(new Set(workspace.selectedIds));
      setCountry(workspace.country);
    } else {
      setCountry('US');
      runDiscovery(focusApp, 'US');
    }
  }, [focusApp, workspaceLoaded, workspace, runDiscovery]);

  const selectFocusApp = useCallback((game: SearchedGame) => {
    hydratedForRef.current = null;
    setFocusApp(game);
    setCompetitors([]);
    setSelectedIds(new Set());
    setDiscoveryError(null);
    setFilters(defaultFilters());
    try {
      localStorage.setItem(FOCUS_APP_KEY, JSON.stringify(game));
    } catch {
      /* ignore */
    }
  }, []);

  const clearFocusApp = useCallback(() => {
    hydratedForRef.current = null;
    setFocusApp(null);
    setCompetitors([]);
    setSelectedIds(new Set());
    setFilters(defaultFilters());
    try {
      localStorage.removeItem(FOCUS_APP_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Data for the workspace: creatives of focus + selected competitors, plus
  // the workspace-scoped insight doc (same shape as the genre one was).
  const analysisAppIds = useMemo(() => {
    if (!focusApp) return [];
    return [focusApp.appId, ...competitors.filter((c) => selectedIds.has(c.appId)).map((c) => c.appId)];
  }, [focusApp, competitors, selectedIds]);

  // Focus + selected competitors with store ids, for the country/OS market lookup.
  const marketApps = useMemo<MarketApp[]>(() => {
    if (!focusApp) return [];
    const focus: MarketApp = {
      appId: focusApp.appId,
      iosAppId: focusApp.iosAppId,
      androidAppId: focusApp.androidAppId,
      isFocus: true,
    };
    const comps = competitors
      .filter((c) => selectedIds.has(c.appId))
      .map<MarketApp>((c) => ({
        appId: c.appId,
        iosAppId: c.iosAppId,
        androidAppId: c.androidAppId,
        isFocus: false,
      }));
    return [focus, ...comps];
  }, [focusApp, competitors, selectedIds]);

  const marketCategory = useMemo(
    () => focusApp?.gameCategory ?? focusApp?.iosCategories[0] ?? null,
    [focusApp],
  );
  const marketAndroidCategory = useMemo(() => focusApp?.androidCategories[0] ?? null, [focusApp]);

  const { data: insightDoc, loading: insightLoading } = useCreativeInsights(scopeId, latestWeek);
  const {
    creatives: joinedCreatives,
    loading: creativesLoading,
    refresh: refreshCreatives,
  } = useCreativesForApps(analysisAppIds, scopeId, latestWeek);

  const { run, start } = useWorkspaceAnalysis(latestWeek);
  const running = run.phase === 'fetching' || run.phase === 'analyzing';

  const startAnalysis = useCallback(
    (force: boolean) => {
      if (!focusApp || running) return;
      const targets = competitors
        .filter((c) => selectedIds.has(c.appId))
        .map((c) => ({
          appId: c.appId,
          name: c.name,
          publisherName: c.publisherName,
          iconUrl: c.iconUrl,
        }));
      void start(
        {
          appId: focusApp.appId,
          name: focusApp.name,
          publisherName: focusApp.publisherName,
          iconUrl: focusApp.iconUrl,
        },
        targets,
        country,
        {
          force,
          onAnalyzed: () => {
            refreshCreatives();
            persistWorkspace({ lastAnalyzedWeek: latestWeek });
          },
        },
      );
    },
    [focusApp, running, competitors, selectedIds, country, start, refreshCreatives, persistWorkspace, latestWeek],
  );

  const toggleSelected = useCallback((appId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  }, []);

  // Persist curation edits (selection, country, manual adds) once state settles;
  // skip the initial hydration pass so loading a workspace doesn't rewrite it.
  const curationInitializedRef = useRef(false);
  useEffect(() => {
    if (!focusApp || discovering || competitors.length === 0) {
      curationInitializedRef.current = false;
      return;
    }
    if (!curationInitializedRef.current) {
      curationInitializedRef.current = true;
      return;
    }
    const t = setTimeout(() => persistWorkspace({}), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, country, competitors]);

  const addCompetitor = useCallback((game: SearchedGame) => {
    const row: DiscoveredCompetitor = {
      appId: game.appId,
      name: game.name,
      publisherName: game.publisherName,
      iosAppId: game.iosAppId,
      androidAppId: game.androidAppId,
      iconUrl: game.iconUrl,
      revenue: null,
      downloads: null,
      source: 'ai',
      reason: 'Added manually',
    };
    setCompetitors((prev) => (prev.some((c) => c.appId === game.appId) ? prev : [...prev, row]));
    setSelectedIds((prev) => new Set(prev).add(game.appId));
  }, []);

  const rankMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!insightDoc?.winners) return m;
    for (const w of insightDoc.winners) {
      if (w.rank <= 10) m.set(w.creativeId, w.rank);
    }
    return m;
  }, [insightDoc]);

  const tagMap = useMemo(() => {
    const m = new Map<string, CreativeTag>();
    for (const t of insightDoc?.creativeTags ?? []) {
      m.set(t.creativeId, t);
    }
    return m;
  }, [insightDoc]);

  // Hooks/themes the focus app already runs — used to flag rising market concepts it's missing.
  const focusTagSets = useMemo(() => {
    const hooks = new Set<string>();
    const themes = new Set<string>();
    const prefix = focusApp ? `${focusApp.appId}__` : null;
    if (prefix) {
      for (const t of insightDoc?.creativeTags ?? []) {
        if (!t.creativeId.startsWith(prefix)) continue;
        hooks.add(t.hookType);
        for (const th of t.themes) themes.add(th.trim().toLowerCase());
      }
    }
    return { hooks, themes };
  }, [insightDoc, focusApp]);

  const appIds = useMemo(() => joinedCreatives.map((c) => c.appId), [joinedCreatives]);
  const appNames = useAppNames(appIds);

  const availableNetworks = useMemo(() => {
    const s = new Set<QueryableAdNetwork>();
    for (const c of joinedCreatives) {
      for (const n of c.networks) s.add(n);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [joinedCreatives]);

  const availableFormats = useMemo(() => {
    const s = new Set<CreativeFormat>();
    for (const c of joinedCreatives) s.add(c.format);
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

  const toggleDurationBucket = useCallback((bucket: string) => {
    setFilters((prev) => {
      const next = new Set(prev.durationBuckets);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return { ...prev, durationBuckets: next };
    });
  }, []);

  const toggleFormatFilter = useCallback((format: CreativeFormat) => {
    setFilters((prev) => {
      const next = new Set(prev.formats);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return { ...prev, formats: next };
    });
  }, []);

  const toggleNetworkFilter = useCallback((network: QueryableAdNetwork) => {
    setFilters((prev) => {
      const next = new Set(prev.networks);
      if (next.has(network)) next.delete(network);
      else next.add(network);
      return { ...prev, networks: next };
    });
  }, []);

  const detailCreative = useMemo(
    () => (detailDocId ? joinedCreatives.find((c) => c.docId === detailDocId) ?? null : null),
    [joinedCreatives, detailDocId],
  );

  useEffect(() => {
    if (detailDocId && !detailCreative) setDetailDocId(null);
  }, [detailDocId, detailCreative]);

  const lastAnalyzed = useMemo(() => {
    const d = generatedAtToDate(insightDoc?.generatedAt);
    return d ? formatTimeAgo(d) : null;
  }, [insightDoc?.generatedAt]);

  const onScrollToCreative = useCallback((docId: string) => {
    document.getElementById(`creative-${docId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const fetchProgress = useMemo(() => {
    let done = 0;
    for (const s of run.appStatuses.values()) {
      if (s.state === 'done' || s.state === 'error') done += 1;
    }
    return { done, total: run.appStatuses.size };
  }, [run.appStatuses]);

  const hasResults = joinedCreatives.length > 0 || insightDoc != null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Creatives</h1>
          <p className="mt-1 text-xs text-gray-500">
            Pick a game, get its competitors, see what's working in their ads.
          </p>
        </div>
        {focusApp && hasResults && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {insightLoading && !insightDoc
                ? 'Loading status…'
                : lastAnalyzed
                  ? `Analyzed ${lastAnalyzed}`
                  : 'Not analyzed yet.'}
            </span>
            <button
              type="button"
              onClick={() => startAnalysis(true)}
              disabled={running || discovering}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Re-fetch this week's creatives for all selected games and re-run the analysis"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      <GameSearch focusApp={focusApp} onSelect={selectFocusApp} onClear={clearFocusApp} />

      {!focusApp && <RecentGamesRow onSelect={selectFocusApp} />}

      {!focusApp && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Start with your game</h3>
          <p className="text-sm text-gray-500">
            Search any game above — AI finds its competitors, pulls their live ad creatives from Sensor
            Tower, and breaks down which hooks and themes are working.
          </p>
        </div>
      )}

      {focusApp && (
        <CompetitorRail
          focusApp={focusApp}
          competitors={competitors}
          selectedIds={selectedIds}
          discovering={discovering || (!workspaceLoaded && competitors.length === 0)}
          discoveryError={discoveryError}
          country={country}
          running={running}
          appStatuses={run.appStatuses}
          creatives={joinedCreatives}
          galleryAppIds={filters.appIds}
          onToggleSelected={toggleSelected}
          onToggleGalleryApp={toggleAppFilter}
          onShowAllCreatives={() => setFilters((prev) => ({ ...prev, appIds: new Set() }))}
          onAddCompetitor={addCompetitor}
          onCountryChange={setCountry}
          onAnalyze={() => startAnalysis(false)}
          onRetryDiscovery={() => focusApp && runDiscovery(focusApp, country)}
        />
      )}

      {focusApp && running && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
          {run.phase === 'fetching' ? (
            <span>
              Fetching creatives… {fetchProgress.done}/{fetchProgress.total} games
              <span className="text-blue-500"> · cached games are instant</span>
            </span>
          ) : (
            <span>Scoring and running AI analysis…</span>
          )}
        </div>
      )}

      {focusApp && !running && run.phase === 'error' && run.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Analysis failed: {run.error}{' '}
          <button
            type="button"
            onClick={() => startAnalysis(false)}
            className="font-semibold underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {focusApp && hasResults && (
        <>
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

          {focusApp && (
            <FormatGapPanel
              creatives={joinedCreatives}
              focusAppId={focusApp.appId}
              selectedFormats={filters.formats}
              selectedDurationBuckets={filters.durationBuckets}
              onToggleFormat={toggleFormatFilter}
              onToggleDurationBucket={toggleDurationBucket}
            />
          )}

          {focusApp && (
            <OpportunityPanel
              creatives={joinedCreatives}
              focusAppId={focusApp.appId}
              marketApps={marketApps}
              category={marketCategory}
              androidCategory={marketAndroidCategory}
              primaryCountry={country}
              appNames={appNames}
              selectedNetworks={filters.networks}
              onToggleNetwork={toggleNetworkFilter}
            />
          )}

          <MarketPulsePanel focusHookTypes={focusTagSets.hooks} focusThemes={focusTagSets.themes} />
        </>
      )}

      {focusApp &&
        (creativesLoading ? (
          <div className="text-center py-12 text-gray-400">Loading creatives…</div>
        ) : joinedCreatives.length === 0 ? (
          !running &&
          !discovering && (
            <div className="text-center py-12 text-gray-400">
              No creatives yet — hit "Analyze creatives" above to fetch this set from Sensor Tower and
              analyze it.
            </div>
          )
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
        ))}

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
