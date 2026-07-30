import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCreativeInsights } from '../hooks/useCreativeInsights';
import { useCreativesForApps } from '../hooks/useCreativesForGenre';
import { useGameWorkspace, useRecentWorkspaces, type GameWorkspace } from '../hooks/useGameWorkspace';
import { useWorkspaceAnalysis } from '../hooks/useWorkspaceAnalysis';
import { useMarketPulse } from '../hooks/useMarketPulse';
import { getCreativeWeekBounds, getLatestCreativeWeek } from '../lib/creativesWeek';
import {
  discoverCompetitors,
  type DiscoveredCompetitor,
  type SearchedGame,
} from '../lib/creativesApi';
import { CreativeGallery } from '../components/creatives/CreativeGallery';
import { GameSearch } from '../components/creatives/GameSearch';
import { CreativesHeader } from '../components/creatives/CreativesHeader';
import { EditSetDrawer } from '../components/creatives/EditSetDrawer';
import { CreativeFilterRail } from '../components/creatives/CreativeFilterRail';
import { WeeksReadBand, type GapRow, type RisingRow } from '../components/creatives/WeeksReadBand';
import { GalleryTabs, type GalleryTab } from '../components/creatives/GalleryTabs';
import { CreativeEmptyState, type ActiveFilterDesc, type RecoveryAction } from '../components/creatives/CreativeEmptyState';
import { CreativeDetailModal } from '../components/creatives/CreativeDetailModal';
import { ConceptGeneratorModal } from '../components/creatives/ConceptGeneratorModal';
import { CreativeCompareModal } from '../components/creatives/CreativeCompareModal';
import { buildCompareItem } from '../lib/creativeCompare';
import { durationBucket } from '../lib/creativeBuckets';
import {
  aggregateHooksThemes,
  buildAppOptions,
  defaultFilters,
  type Filters,
} from '../lib/creativeFilters';
import { computeCreativeGaps, isCreativeInGap, type CreativeGaps } from '../lib/creativeGaps';
import { groupVariants, NO_VARIANTS } from '../lib/creativeVariants';
import { useAppNames, type AppNameMapEntry } from '../hooks/useAppNames';
import type { CreativeTag, QueryableAdNetwork, RisingConcept } from '../types/creatives';
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
  focusAppId: string,
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

  if (filters.hideOwnGame) out = out.filter((c) => c.appId !== focusAppId);
  if (filters.networks.size > 0) out = out.filter((c) => c.networks.some((n) => filters.networks.has(n)));
  if (filters.formats.size > 0) out = out.filter((c) => filters.formats.has(c.format));
  if (filters.durationBuckets.size > 0) {
    out = out.filter((c) => c.format === 'video' && filters.durationBuckets.has(durationBucket(c.videoDurationSec)));
  }
  if (filters.appIds.size > 0) out = out.filter((c) => filters.appIds.has(c.appId));
  if (filters.newThisWeek) {
    out = out.filter((c) => {
      const t = parseSeenMs(c.firstSeen);
      return t !== null && t >= Date.now() - 7 * 86400000;
    });
  }
  if (filters.winnersOnly) out = out.filter((c) => c.score != null && c.score >= 60);

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

/** The gallery tab presets — quick filters over the same list. */
function applyTab(list: JoinedCreative[], tab: GalleryTab, gaps: CreativeGaps, focusAppId: string): JoinedCreative[] {
  switch (tab) {
    case 'winners':
      return list.filter((c) => c.score != null && c.score >= 60);
    case 'new':
      return list.filter((c) => {
        const t = parseSeenMs(c.firstSeen);
        return t !== null && t >= Date.now() - 7 * 86400000;
      });
    case 'gaps':
      return list.filter((c) => c.appId !== focusAppId && isCreativeInGap(c, gaps.gapFormats, gaps.gapDurations));
    default:
      return list;
  }
}

/** True when the focus app isn't already running this rising concept. */
function isMissingConcept(c: RisingConcept, focusHooks: Set<string>, focusThemes: Set<string>): boolean {
  if (c.kind === 'hook') return !focusHooks.has(c.label);
  return !focusThemes.has(c.label.toLowerCase());
}

function RecentGamesRow({
  onSelect,
  onRefresh,
}: {
  onSelect: (game: SearchedGame) => void;
  onRefresh: (game: SearchedGame) => void;
}) {
  const { recent, remove } = useRecentWorkspaces();
  if (recent.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-gray-400">Recent games</span>
      {recent.map((r) => (
        <div
          key={r.focusApp.appId}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 pl-2.5 pr-1.5 text-xs font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50"
        >
          <button type="button" onClick={() => onSelect(r.focusApp)} className="inline-flex items-center gap-1.5">
            {r.focusApp.iconUrl && <img src={r.focusApp.iconUrl} alt="" className="w-4 h-4 rounded" />}
            {r.focusApp.name}
            {r.updatedAt && <span className="text-[10px] text-gray-400">{formatTimeAgo(r.updatedAt)}</span>}
          </button>
          <button
            type="button"
            title={`Refresh ${r.focusApp.name}'s competitors`}
            aria-label={`Refresh ${r.focusApp.name}'s competitors`}
            onClick={() => onRefresh(r.focusApp)}
            className="flex h-4 w-4 items-center justify-center rounded-full text-sm leading-none text-gray-400 hover:bg-blue-100 hover:text-blue-600"
          >
            ↻
          </button>
          <button
            type="button"
            title={`Delete ${r.focusApp.name} from recent`}
            aria-label={`Delete ${r.focusApp.name} from recent`}
            onClick={() => {
              if (window.confirm(`Remove "${r.focusApp.name}" and its saved competitors?`)) {
                void remove(r.focusApp.appId);
              }
            }}
            className="flex h-4 w-4 items-center justify-center rounded-full text-xs leading-none text-gray-400 hover:bg-red-100 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Creatives() {
  const [focusApp, setFocusApp] = useState<SearchedGame | null>(() => loadStoredFocusApp());
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GalleryTab>('all');
  const [editSetOpen, setEditSetOpen] = useState(false);
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const [groupVariantsOn, setGroupVariantsOn] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

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

  // Hydrate curation state once per focused game.
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
    setActiveTab('all');
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
    setActiveTab('all');
    try {
      localStorage.removeItem(FOCUS_APP_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshRecent = useCallback(
    (game: SearchedGame) => {
      selectFocusApp(game);
      hydratedForRef.current = game.appId;
      setCountry('US');
      runDiscovery(game, 'US');
    },
    [selectFocusApp, runDiscovery],
  );

  const analysisAppIds = useMemo(() => {
    if (!focusApp) return [];
    return [focusApp.appId, ...competitors.filter((c) => selectedIds.has(c.appId)).map((c) => c.appId)];
  }, [focusApp, competitors, selectedIds]);

  const { data: insightDoc, loading: insightLoading } = useCreativeInsights(scopeId, latestWeek);
  const {
    creatives: joinedCreatives,
    loading: creativesLoading,
    refresh: refreshCreatives,
  } = useCreativesForApps(analysisAppIds, scopeId, latestWeek);

  const { run, start } = useWorkspaceAnalysis(latestWeek);
  const running = run.phase === 'fetching' || run.phase === 'analyzing';
  const { data: pulse } = useMarketPulse();

  const startAnalysis = useCallback(
    (force: boolean) => {
      if (!focusApp || running) return;
      const targets = competitors
        .filter((c) => selectedIds.has(c.appId))
        .map((c) => ({ appId: c.appId, name: c.name, publisherName: c.publisherName, iconUrl: c.iconUrl }));
      void start(
        { appId: focusApp.appId, name: focusApp.name, publisherName: focusApp.publisherName, iconUrl: focusApp.iconUrl },
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

  // Persist curation edits once state settles; skip the initial hydration pass.
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

  const removeCompetitor = useCallback((appId: string) => {
    setCompetitors((prev) => prev.filter((c) => c.appId !== appId));
    setSelectedIds((prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Set(prev);
      next.delete(appId);
      return next;
    });
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
    for (const t of insightDoc?.creativeTags ?? []) m.set(t.creativeId, t);
    return m;
  }, [insightDoc]);

  // Hooks/themes the focus app already runs — used to flag rising concepts it's missing.
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
    for (const c of joinedCreatives) for (const n of c.networks) s.add(n);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [joinedCreatives]);

  const appOptions = useMemo(
    () => buildAppOptions([...new Set(joinedCreatives.map((c) => c.appId))], appNames),
    [joinedCreatives, appNames],
  );

  const focusAppId = focusApp?.appId ?? '';

  /** Everything except hook/theme filters — feeds the rail counts so they stay stable. */
  const baseFilteredCreatives = useMemo(
    () => applyCreativeFilters(joinedCreatives, filters, appNames, focusAppId),
    [joinedCreatives, filters, appNames, focusAppId],
  );

  const gaps = useMemo(() => computeCreativeGaps(joinedCreatives, focusAppId), [joinedCreatives, focusAppId]);

  const filteredCreatives = useMemo(
    () => applyTagFilters(baseFilteredCreatives, filters, tagMap),
    [baseFilteredCreatives, filters, tagMap],
  );

  const galleryCreatives = useMemo(
    () => applyTab(filteredCreatives, activeTab, gaps, focusAppId),
    [filteredCreatives, activeTab, gaps, focusAppId],
  );

  // Collapse same-concept creatives (shared phashionGroup across apps) into one
  // representative tile with aggregated SoV/longevity. Pure display transform on
  // the already-filtered gallery list; analysis aggregations stay on the raw set.
  const variantView = useMemo(() => groupVariants(galleryCreatives), [galleryCreatives]);
  const displayCreatives = groupVariantsOn ? variantView.representatives : galleryCreatives;
  const variantMeta = groupVariantsOn ? variantView.meta : NO_VARIANTS;

  // ---- Side-by-side compare (#5) ---------------------------------------------
  const comparingSet = useMemo(() => new Set(compareIds), [compareIds]);

  const toggleCompare = useCallback((docId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(docId)) return prev.filter((id) => id !== docId);
      // Cap at 2 — adding a third drops the oldest so the pick stays fluid.
      return prev.length < 2 ? [...prev, docId] : [prev[1], docId];
    });
  }, []);

  const exitCompare = useCallback(() => {
    setCompareMode(false);
    setCompareIds([]);
    setCompareOpen(false);
  }, []);

  const compareItems = useMemo(() => {
    const byId = new Map(joinedCreatives.map((c) => [c.docId, c]));
    return compareIds
      .map((id) => byId.get(id))
      .filter((c): c is JoinedCreative => !!c)
      .map((c) => buildCompareItem(c, insightDoc, appNames.get(c.appId)));
  }, [compareIds, joinedCreatives, insightDoc, appNames]);

  // Preset: the focus game's strongest creative vs the top competitor creative.
  const compareFocusVsTop = useCallback(() => {
    const best = (pred: (c: JoinedCreative) => boolean) =>
      joinedCreatives.filter(pred).reduce<JoinedCreative | null>((top, c) => {
        if (c.score == null) return top;
        return top == null || c.score > (top.score ?? -Infinity) ? c : top;
      }, null);
    const mine = best((c) => c.appId === focusAppId);
    const theirs = best((c) => c.appId !== focusAppId);
    if (!mine || !theirs) return;
    setCompareMode(true);
    setCompareIds([mine.docId, theirs.docId]);
    setCompareOpen(true);
  }, [joinedCreatives, focusAppId]);

  const hasFocusCreative = useMemo(() => joinedCreatives.some((c) => c.appId === focusAppId && c.score != null), [joinedCreatives, focusAppId]);

  // Rail aggregation (stable, over the pre-tag-filter list).
  const railAgg = useMemo(() => aggregateHooksThemes(baseFilteredCreatives, tagMap), [baseFilteredCreatives, tagMap]);
  // Band aggregation (over the whole set — the band resets filters when clicked).
  const bandAgg = useMemo(() => aggregateHooksThemes(joinedCreatives, tagMap), [joinedCreatives, tagMap]);

  const creativeCountByApp = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of joinedCreatives) m.set(c.appId, (m.get(c.appId) ?? 0) + 1);
    return m;
  }, [joinedCreatives]);

  const tabCounts = useMemo<Record<GalleryTab, number>>(
    () => ({
      winners: applyTab(baseFilteredCreatives, 'winners', gaps, focusAppId).length,
      new: applyTab(baseFilteredCreatives, 'new', gaps, focusAppId).length,
      gaps: applyTab(baseFilteredCreatives, 'gaps', gaps, focusAppId).length,
      all: baseFilteredCreatives.length,
    }),
    [baseFilteredCreatives, gaps, focusAppId],
  );

  // ---- Band cards ------------------------------------------------------------
  const scrollGalleryTop = useCallback(() => {
    const main = pageRef.current?.closest('main');
    main?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const applyShortcut = useCallback(
    (partial: Partial<Filters>, tab: GalleryTab = 'all') => {
      setFilters({ ...defaultFilters(), ...partial });
      setActiveTab(tab);
      scrollGalleryTop();
    },
    [scrollGalleryTop],
  );

  const copyThisCard = useMemo(() => {
    const top = bandAgg.hooks[0];
    if (!top) return null;
    return {
      hook: top.hookType,
      count: top.count,
      thumbs: top.examples.slice(0, 4).map((c) => c.thumbnailUrl ?? c.mediaUrl ?? null),
    };
  }, [bandAgg]);

  const gapRows = useMemo<GapRow[]>(() => {
    const rows: GapRow[] = [];
    for (const r of gaps.lengths) if (r.key !== 'unknown' && r.focusCount === 0 && r.compGames >= 2 && r.compCount >= 3)
      rows.push({ key: r.key, compCount: r.compCount, you: r.focusCount });
    for (const r of gaps.formats) if (r.focusCount === 0 && r.compGames >= 2 && r.compCount >= 3)
      rows.push({ key: r.key === 'unknown' ? 'Unknown' : r.key.charAt(0).toUpperCase() + r.key.slice(1), compCount: r.compCount, you: r.focusCount });
    return rows.sort((a, b) => b.compCount - a.compCount).slice(0, 3);
  }, [gaps]);

  const gapTotal = useMemo(
    () => joinedCreatives.filter((c) => c.appId !== focusAppId && isCreativeInGap(c, gaps.gapFormats, gaps.gapDurations)).length,
    [joinedCreatives, gaps, focusAppId],
  );

  const risingData = useMemo(() => {
    if (!pulse) return { rows: [] as RisingRow[], total: 0, hookLabels: new Set<string>(), themes: new Set<string>() };
    const ranked = [...pulse.risingConcepts]
      .map((c) => ({ c, missing: isMissingConcept(c, focusTagSets.hooks, focusTagSets.themes) }))
      .sort((a, b) => {
        if (a.missing !== b.missing) return a.missing ? -1 : 1;
        if (a.c.isNew !== b.c.isNew) return a.c.isNew ? -1 : 1;
        return (b.c.wowGrowthPct ?? 0) - (a.c.wowGrowthPct ?? 0);
      });
    const rows: RisingRow[] = ranked.slice(0, 3).map(({ c, missing }) => ({
      label: c.title || c.label,
      delta: c.isNew ? 'NEW' : c.wowGrowthPct != null ? `+${c.wowGrowthPct}%` : '',
      missing,
    }));
    const hookLabels = new Set(ranked.filter((x) => x.c.kind === 'hook').map((x) => x.c.label));
    const themes = new Set(ranked.filter((x) => x.c.kind === 'theme').map((x) => x.c.label.toLowerCase()));
    const total = joinedCreatives.filter((c) => {
      const t = tagMap.get(c.docId);
      if (!t) return false;
      if (hookLabels.has(t.hookType)) return true;
      return t.themes.some((th) => themes.has(th.trim().toLowerCase()));
    }).length;
    return { rows, total, hookLabels, themes };
  }, [pulse, focusTagSets, joinedCreatives, tagMap]);

  // ---- Empty-state recovery --------------------------------------------------
  const galleryCountFor = useCallback(
    (f: Filters, tab: GalleryTab) =>
      applyTab(applyTagFilters(applyCreativeFilters(joinedCreatives, f, appNames, focusAppId), f, tagMap), tab, gaps, focusAppId).length,
    [joinedCreatives, appNames, focusAppId, tagMap, gaps],
  );

  const activeFilterDescs = useMemo<ActiveFilterDesc[]>(() => {
    const out: ActiveFilterDesc[] = [];
    if (filters.search.trim()) out.push({ label: `"${filters.search.trim()}"`, isAiTag: false });
    for (const n of filters.networks) out.push({ label: n, isAiTag: false });
    for (const f of filters.formats) out.push({ label: f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1), isAiTag: false });
    for (const b of filters.durationBuckets) out.push({ label: b, isAiTag: false });
    for (const id of filters.appIds) out.push({ label: appNames.get(id)?.name ?? id, isAiTag: false });
    for (const h of filters.hookTypes) out.push({ label: h, isAiTag: true });
    for (const t of filters.themes) out.push({ label: t, isAiTag: true });
    if (filters.newThisWeek) out.push({ label: 'New this week', isAiTag: false });
    if (filters.winnersOnly) out.push({ label: 'Winners only', isAiTag: false });
    if (filters.hideOwnGame) out.push({ label: 'Hide my own game', isAiTag: false });
    if (activeTab !== 'all') out.push({ label: activeTab === 'new' ? 'New this week' : activeTab === 'gaps' ? 'Your gaps' : 'Winners', isAiTag: false });
    return out;
  }, [filters, appNames, activeTab]);

  const recovery = useMemo<RecoveryAction | null>(() => {
    type Cand = { label: string; count: number; apply: () => void };
    const cands: Cand[] = [];
    const withF = (patch: Partial<Filters>): Filters => ({ ...filters, ...patch });
    const delFrom = <T,>(set: Set<T>, v: T) => {
      const n = new Set(set);
      n.delete(v);
      return n;
    };
    const push = (label: string, f: Filters, tab: GalleryTab, apply: () => void) => {
      const count = galleryCountFor(f, tab);
      if (count > 0) cands.push({ label: `Drop "${label}" → ${count} result${count === 1 ? '' : 's'}`, count, apply });
    };

    if (filters.search.trim()) push('search', withF({ search: '' }), activeTab, () => setFilters((p) => ({ ...p, search: '' })));
    for (const n of filters.networks) push(n, withF({ networks: delFrom(filters.networks, n) }), activeTab, () => setFilters((p) => ({ ...p, networks: delFrom(p.networks, n) })));
    for (const f of filters.formats) push(f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1), withF({ formats: delFrom(filters.formats, f) }), activeTab, () => setFilters((p) => ({ ...p, formats: delFrom(p.formats, f) })));
    for (const b of filters.durationBuckets) push(b, withF({ durationBuckets: delFrom(filters.durationBuckets, b) }), activeTab, () => setFilters((p) => ({ ...p, durationBuckets: delFrom(p.durationBuckets, b) })));
    for (const id of filters.appIds) push(appNames.get(id)?.name ?? id, withF({ appIds: delFrom(filters.appIds, id) }), activeTab, () => setFilters((p) => ({ ...p, appIds: delFrom(p.appIds, id) })));
    for (const h of filters.hookTypes) push(h, withF({ hookTypes: delFrom(filters.hookTypes, h) }), activeTab, () => setFilters((p) => ({ ...p, hookTypes: delFrom(p.hookTypes, h) })));
    for (const t of filters.themes) push(t, withF({ themes: delFrom(filters.themes, t) }), activeTab, () => setFilters((p) => ({ ...p, themes: delFrom(p.themes, t) })));
    if (filters.newThisWeek) push('New this week', withF({ newThisWeek: false }), activeTab, () => setFilters((p) => ({ ...p, newThisWeek: false })));
    if (filters.winnersOnly) push('Winners only', withF({ winnersOnly: false }), activeTab, () => setFilters((p) => ({ ...p, winnersOnly: false })));
    if (filters.hideOwnGame) push('Hide my own game', withF({ hideOwnGame: false }), activeTab, () => setFilters((p) => ({ ...p, hideOwnGame: false })));
    if (activeTab !== 'all') {
      const count = galleryCountFor(filters, 'all');
      if (count > 0) cands.push({ label: `Show all → ${count} result${count === 1 ? '' : 's'}`, count, apply: () => setActiveTab('all') });
    }

    cands.sort((a, b) => b.count - a.count);
    const best = cands[0];
    return best ? { label: best.label, onApply: best.apply } : null;
  }, [filters, activeTab, appNames, galleryCountFor]);

  // ---- Detail / status -------------------------------------------------------
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

  const weekLabel = useMemo(() => {
    const { startDate } = getCreativeWeekBounds(latestWeek);
    const d = new Date(`${startDate}T00:00:00Z`);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }, [latestWeek]);

  const fetchProgress = useMemo(() => {
    let done = 0;
    for (const s of run.appStatuses.values()) if (s.state === 'done' || s.state === 'error') done += 1;
    return { done, total: run.appStatuses.size };
  }, [run.appStatuses]);

  const hasCreatives = joinedCreatives.length > 0;
  const aiChips = useMemo(
    () => [
      ...[...filters.hookTypes].map((h) => ({ key: `h-${h}`, label: h, onRemove: () => setFilters((p) => { const n = new Set(p.hookTypes); n.delete(h); return { ...p, hookTypes: n }; }) })),
      ...[...filters.themes].map((t) => ({ key: `t-${t}`, label: t, onRemove: () => setFilters((p) => { const n = new Set(p.themes); n.delete(t); return { ...p, themes: n }; }) })),
    ],
    [filters.hookTypes, filters.themes],
  );

  // ---- No focus game: search-first entry ------------------------------------
  if (!focusApp) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Creatives</h1>
          <p className="mt-1 text-xs text-gray-500">Pick a game, get its competitors, see what's working in their ads.</p>
        </div>
        <GameSearch focusApp={null} onSelect={selectFocusApp} onClear={clearFocusApp} />
        <RecentGamesRow onSelect={selectFocusApp} onRefresh={refreshRecent} />
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Start with your game</h3>
          <p className="text-sm text-gray-500">
            Search any game above — AI finds its competitors, pulls their live ad creatives from Sensor Tower, and breaks
            down which hooks and themes are working.
          </p>
        </div>
      </div>
    );
  }

  const railProps = {
    focusApp,
    competitors,
    selectedIds,
    discovering: discovering || (!workspaceLoaded && competitors.length === 0),
    discoveryError,
    country,
    running,
    appStatuses: run.appStatuses,
    creatives: joinedCreatives,
    galleryAppIds: filters.appIds,
    onToggleSelected: toggleSelected,
    onToggleGalleryApp: (id: string) => setFilters((p) => { const n = new Set(p.appIds); if (n.has(id)) n.delete(id); else n.add(id); return { ...p, appIds: n }; }),
    onRemoveCompetitor: removeCompetitor,
    onShowAllCreatives: () => setFilters((p) => ({ ...p, appIds: new Set<string>() })),
    onAddCompetitor: addCompetitor,
    onCountryChange: setCountry,
    onAnalyze: () => startAnalysis(false),
    onRetryDiscovery: () => focusApp && runDiscovery(focusApp, country),
  };

  return (
    <div ref={pageRef} className="-m-6 bg-ground lg:-m-8">
      <CreativesHeader
        focusApp={focusApp}
        competitors={competitors}
        selectedIds={selectedIds}
        creativeCount={joinedCreatives.length}
        gameCount={analysisAppIds.length}
        country={country}
        weekLabel={weekLabel}
        lastAnalyzed={lastAnalyzed}
        statusLoading={insightLoading && !insightDoc}
        busy={running || discovering}
        creativeCountByApp={creativeCountByApp}
        onCountryChange={setCountry}
        onRefresh={refreshCreatives}
        onReanalyze={() => startAnalysis(true)}
        onGenerateConcepts={() => setConceptsOpen(true)}
        onEditSet={() => setEditSetOpen(true)}
        onChangeGame={clearFocusApp}
      />

      {running && (
        <div className="flex items-center gap-2 border-b border-line bg-accent-tint px-7 py-2 text-xs text-accent-text">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent-border border-t-accent" />
          {run.phase === 'fetching'
            ? `Fetching creatives… ${fetchProgress.done}/${fetchProgress.total} games · cached games are instant`
            : 'Scoring and running AI analysis…'}
        </div>
      )}
      {!running && run.phase === 'error' && run.error && (
        <div className="border-b border-red-200 bg-red-50 px-7 py-2 text-xs text-red-700">
          Analysis failed: {run.error}{' '}
          <button type="button" onClick={() => startAnalysis(false)} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {hasCreatives ? (
        <>
          <WeeksReadBand
            verdict={insightDoc?.summary?.trim() ? insightDoc.summary : null}
            copyThis={copyThisCard}
            gaps={gapRows}
            gapTotal={gapTotal}
            rising={risingData.rows}
            risingTotal={risingData.total}
            onCopyThis={() => copyThisCard && applyShortcut({ hookTypes: new Set([copyThisCard.hook]) })}
            onShowGaps={() => applyShortcut({}, 'gaps')}
            onShowRising={() => applyShortcut({ hookTypes: risingData.hookLabels, themes: risingData.themes })}
          />

          <div className="flex items-start">
            <CreativeFilterRail
              filters={filters}
              setFilters={setFilters}
              onClear={() => { setFilters(defaultFilters()); setActiveTab('all'); }}
              baseFilteredCreatives={baseFilteredCreatives}
              hookAggs={railAgg.hooks}
              themeAggs={railAgg.themes}
              availableNetworks={availableNetworks}
              appOptions={appOptions}
              appNames={appNames}
              focusAppId={focusAppId}
            />
            <div className="min-w-0 flex-1 px-7 pb-8 pt-[18px]">
              <GalleryTabs
                activeTab={activeTab}
                counts={tabCounts}
                onSelect={setActiveTab}
                aiChips={aiChips}
                sort={filters.sort}
                onSortChange={(sort) => setFilters((p) => ({ ...p, sort }))}
                groupVariants={groupVariantsOn}
                onToggleGroupVariants={setGroupVariantsOn}
                compareMode={compareMode}
                onToggleCompareMode={(next) => (next ? setCompareMode(true) : exitCompare())}
              />

              {compareMode && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent-border bg-accent-tint px-3.5 py-2.5">
                  <span className="text-xs font-medium text-accent-text">
                    Compare — pick 2 · {compareIds.length}/2 selected
                  </span>
                  <button
                    type="button"
                    disabled={compareItems.length < 2}
                    onClick={() => setCompareOpen(true)}
                    className="rounded-md border border-accent bg-surface px-2.5 py-1 text-xs font-medium text-accent-text hover:bg-white disabled:opacity-50"
                  >
                    Compare these 2
                  </button>
                  {hasFocusCreative && (
                    <button
                      type="button"
                      onClick={compareFocusVsTop}
                      className="text-xs font-medium text-accent-text hover:underline"
                    >
                      My best vs their best
                    </button>
                  )}
                  <button type="button" onClick={exitCompare} className="ml-auto text-xs text-ink-muted hover:text-ink">
                    Done
                  </button>
                </div>
              )}
              {galleryCreatives.length === 0 ? (
                <CreativeEmptyState
                  activeFilters={activeFilterDescs}
                  recovery={recovery}
                  onClearAll={() => { setFilters(defaultFilters()); setActiveTab('all'); }}
                />
              ) : (
                <>
                  {groupVariantsOn && variantView.collapsed > 0 && (
                    <p className="pt-3 text-[11px] text-ink-muted">
                      Showing {displayCreatives.length} concept{displayCreatives.length === 1 ? '' : 's'} · {variantView.collapsed} variant
                      {variantView.collapsed === 1 ? '' : 's'} grouped by matching creative
                    </p>
                  )}
                  <CreativeGallery
                    creatives={displayCreatives}
                    rankMap={rankMap}
                    appNames={appNames}
                    tagMap={tagMap}
                    variantMeta={variantMeta}
                    focusAppId={focusAppId}
                    compareMode={compareMode}
                    comparingIds={comparingSet}
                    onToggleCompare={toggleCompare}
                    onOpen={setDetailDocId}
                  />
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="px-7 py-16 text-center text-sm text-ink-muted">
          {creativesLoading || discovering ? (
            'Loading creatives…'
          ) : (
            <>
              No creatives yet.{' '}
              <button type="button" onClick={() => setEditSetOpen(true)} className="font-medium text-accent-text underline">
                Open the set
              </button>{' '}
              to fetch this week from Sensor Tower, or hit Re-analyze.
            </>
          )}
        </div>
      )}

      <EditSetDrawer open={editSetOpen} onClose={() => setEditSetOpen(false)} {...railProps} />

      <CreativeDetailModal
        key={detailDocId ?? 'closed'}
        open={detailDocId != null}
        onClose={() => setDetailDocId(null)}
        creative={detailCreative}
        insightDoc={insightDoc}
        appEntry={detailCreative ? appNames.get(detailCreative.appId) : undefined}
        rank={detailCreative ? rankMap.get(detailCreative.docId) : undefined}
        country={country}
        scopeId={scopeId}
        week={latestWeek}
      />

      <ConceptGeneratorModal
        open={conceptsOpen}
        onClose={() => setConceptsOpen(false)}
        insightDoc={insightDoc}
        focusAppId={focusAppId}
        focusGameName={focusApp.name}
        scopeId={scopeId}
        week={latestWeek}
        gaps={gapRows.map((g) => g.key)}
        rising={risingData.rows.filter((r) => r.missing).map((r) => r.label)}
        appNames={appNames}
      />

      <CreativeCompareModal
        open={compareOpen && compareItems.length === 2}
        onClose={() => setCompareOpen(false)}
        a={compareItems[0] ?? null}
        b={compareItems[1] ?? null}
      />
    </div>
  );
}
