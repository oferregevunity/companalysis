import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackedApp } from '../../hooks/useTrackedApps';
import type { Genre } from '../../types';

export interface GameSearchProps {
  apps: TrackedApp[];
  genres: Genre[];
  loading: boolean;
  focusApp: TrackedApp | null;
  onSelect: (app: TrackedApp) => void;
  onClear: () => void;
}

function rankMatches(apps: TrackedApp[], q: string): TrackedApp[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const scored: Array<{ app: TrackedApp; rank: number }> = [];
  for (const app of apps) {
    const name = app.name.toLowerCase();
    const pub = app.publisherName.toLowerCase();
    let rank: number | null = null;
    if (name.startsWith(query)) rank = 0;
    else if (name.includes(query)) rank = 1;
    else if (pub.includes(query)) rank = 2;
    if (rank !== null) scored.push({ app, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || b.app.latestRevenue - a.app.latestRevenue);
  return scored.slice(0, 8).map((s) => s.app);
}

/**
 * Search-first entry point: type your game's name, pick it, and the page
 * pivots to that game's genre + competitors.
 */
export function GameSearch({ apps, genres, loading, focusApp, onSelect, onClear }: GameSearchProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const genreNames = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);
  const matches = useMemo(() => rankMatches(apps, q), [apps, q]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const select = (app: TrackedApp) => {
    onSelect(app);
    setQ('');
    setOpen(false);
  };

  if (focusApp) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
        <span className="text-xs font-medium text-blue-600 uppercase tracking-wide shrink-0">Your game</span>
        <span className="text-sm font-semibold text-gray-900 truncate">{focusApp.name}</span>
        {focusApp.publisherName && (
          <span className="text-xs text-gray-500 truncate hidden sm:inline">{focusApp.publisherName}</span>
        )}
        <div className="flex gap-1">
          {focusApp.genreIds.map((gid) => (
            <span key={gid} className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">
              {genreNames.get(gid) ?? gid}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto shrink-0 rounded-full p-1 text-gray-400 hover:bg-blue-100 hover:text-gray-700"
          aria-label="Clear selected game"
          title="Clear selected game"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-label="Search your game"
          placeholder={loading ? 'Loading tracked games…' : 'Search your game to find its competitors…'}
          value={q}
          disabled={loading}
          onChange={(e) => {
            setQ(e.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' && matches[highlighted]) {
              e.preventDefault();
              select(matches[highlighted]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="w-full rounded-xl border border-gray-300 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>

      {open && q.trim() && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {matches.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-gray-400">
              No tracked game matches “{q.trim()}”. Games appear here once their genre is tracked in Settings.
            </p>
          ) : (
            <ul role="listbox">
              {matches.map((app, i) => (
                <li key={app.appId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlighted}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => select(app)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                      i === highlighted ? 'bg-blue-50' : 'bg-white'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{app.name}</span>
                      <span className="block text-xs text-gray-500 truncate">{app.publisherName || '—'}</span>
                    </span>
                    <span className="flex gap-1 shrink-0">
                      {app.genreIds.slice(0, 2).map((gid) => (
                        <span key={gid} className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                          {genreNames.get(gid) ?? gid}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
