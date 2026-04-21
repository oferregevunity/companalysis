import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGenres } from '../hooks/useGenres';
import { useCreativeInsights } from '../hooks/useCreativeInsights';
import { useCreativesForGenre } from '../hooks/useCreativesForGenre';
import { getCreativeWeekBounds, getLatestCreativeWeek } from '../lib/creativesWeek';
import { triggerCreativesForGenre } from '../lib/creativesApi';
import { AIHighlightsStrip } from '../components/creatives/AIHighlightsStrip';
import { CreativeGallery } from '../components/creatives/CreativeGallery';
import { useAppNames } from '../hooks/useAppNames';

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

export default function Creatives() {
  const { genres, loading: genresLoading } = useGenres();
  const [selectedGenreId, setSelectedGenreId] = useState<string>('');
  const [generating, setGenerating] = useState(false);

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
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const { data: insightDoc, loading: insightLoading } = useCreativeInsights(selectedGenreId, latestWeek);
  const { creatives: joinedCreatives, loading: creativesLoading } = useCreativesForGenre(selectedGenreId, latestWeek);

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
    setGenerating(true);
    try {
      const { startDate, endDate } = getCreativeWeekBounds(latestWeek);
      await triggerCreativesForGenre(selectedGenreId, startDate, endDate);
    } catch (err) {
      console.error('triggerCreativesForGenre', err);
    } finally {
      setGenerating(false);
    }
  }, [selectedGenreId, latestWeek]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Creatives</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm text-gray-500">
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
            {generating ? 'Analyzing…' : 'Re-analyze'}
          </button>
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
        <CreativeGallery
          creatives={joinedCreatives}
          rankMap={rankMap}
          appNames={appNames}
          onOpen={() => {}}
        />
      )}
    </div>
  );
}
