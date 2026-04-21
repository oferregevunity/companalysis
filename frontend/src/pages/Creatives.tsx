import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGenres } from '../hooks/useGenres';
import { useCreativeInsights } from '../hooks/useCreativeInsights';
import { getLatestCreativeWeek } from '../lib/creativesWeek';

const STORAGE_KEY = 'creatives.selectedGenreId';

function generatedAtToDate(
  v: { seconds: number; nanoseconds: number } | Date | undefined,
): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && 'seconds' in v) {
    return new Date(v.seconds * 1000);
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

  const lastAnalyzed = useMemo(() => {
    const d = generatedAtToDate(insightDoc?.generatedAt);
    if (!d) return null;
    return formatTimeAgo(d);
  }, [insightDoc?.generatedAt]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Creatives</h1>
        <div className="text-sm text-gray-500">
          {insightLoading && !insightDoc ? (
            <span>Loading status…</span>
          ) : lastAnalyzed ? (
            <span>Last analyzed {lastAnalyzed}</span>
          ) : (
            <span>Never analyzed.</span>
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

      <div />
    </div>
  );
}
