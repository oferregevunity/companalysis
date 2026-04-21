import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGenres } from '../hooks/useGenres';
import { useCreativeInsights } from '../hooks/useCreativeInsights';
import { useCreativesForGenre } from '../hooks/useCreativesForGenre';
import { useGenreDataStatus } from '../hooks/useGenreDataStatus';
import { getCreativeWeekBounds, getLatestCreativeWeek } from '../lib/creativesWeek';
import { triggerCreativesForGenre } from '../lib/creativesApi';
import { AIHighlightsStrip } from '../components/creatives/AIHighlightsStrip';
import { CreativeGallery } from '../components/creatives/CreativeGallery';
import {
  buildAppOptions,
  CreativeFilters,
  defaultFilters,
  type Filters,
} from '../components/creatives/CreativeFilters';
import { CreativeDetailModal } from '../components/creatives/CreativeDetailModal';
import { useAppNames, type AppNameMapEntry } from '../hooks/useAppNames';
import type { CreativeFormat, QueryableAdNetwork } from '../types/creatives';
import type { JoinedCreative } from '../hooks/useCreativesForGenre';

const STORAGE_KEY = 'creatives.selectedGenreId';

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
  const [generating, setGenerating] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [reanalyzeSuccess, setReanalyzeSuccess] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const latestWeek = useMemo(() => getLatestCreativeWeek(), []);

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

  const selectGenre = useCallback((id: string) => {
    setSelectedGenreId(id);
    setReanalyzeError(null);
    setReanalyzeSuccess(null);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const { data: insightDoc, loading: insightLoading } = useCreativeInsights(selectedGenreId, latestWeek);
  const { creatives: joinedCreatives, loading: creativesLoading } = useCreativesForGenre(selectedGenreId, latestWeek);
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

  const appIds = useMemo(() => joinedCreatives.map((c) => c.appId), [joinedCreatives]);
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

  const filteredCreatives = useMemo(
    () => applyCreativeFilters(joinedCreatives, filters, appNames),
    [joinedCreatives, filters, appNames],
  );

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

      <div className="flex flex-wrap gap-2">
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

      <AIHighlightsStrip
        insightDoc={insightDoc}
        joinedCreatives={joinedCreatives}
        loading={insightLoading}
        onScrollToCreative={onScrollToCreative}
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
