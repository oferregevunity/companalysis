import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameSearch } from '../../hooks/useGameSearch';
import { matchGenresForGame } from '../../lib/gameGenres';
import type { SearchedGame } from '../../lib/creativesApi';
import type { Genre } from '../../types';

export interface GameSearchProps {
  genres: Genre[];
  focusApp: SearchedGame | null;
  onSelect: (app: SearchedGame) => void;
  onClear: () => void;
}

function GenreChips({ game, genres }: { game: SearchedGame; genres: Genre[] }) {
  const matched = matchGenresForGame(game, genres);
  if (matched.length === 0) {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500">
        Genre not tracked
      </span>
    );
  }
  return (
    <>
      {matched.slice(0, 2).map((g) => (
        <span key={g.id} className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
          {g.name}
        </span>
      ))}
    </>
  );
}

/**
 * Search-first entry point: type any game's name (live Sensor Tower catalog
 * search), pick it, and the page pivots to that game's genre + competitors.
 */
export function GameSearch({ genres, focusApp, onSelect, onClear }: GameSearchProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const { results, searching, error } = useGameSearch(q);
  const focusGenres = useMemo(
    () => (focusApp ? matchGenresForGame(focusApp, genres) : []),
    [focusApp, genres],
  );

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Results arrive async, so clamp rather than resetting state in an effect.
  const highlightedIndex = results.length === 0 ? 0 : Math.min(highlighted, results.length - 1);

  const select = (app: SearchedGame) => {
    onSelect(app);
    setQ('');
    setOpen(false);
  };

  if (focusApp) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
        <span className="text-xs font-medium text-blue-600 uppercase tracking-wide shrink-0">Your game</span>
        {focusApp.iconUrl && (
          <img src={focusApp.iconUrl} alt="" className="w-5 h-5 rounded shrink-0" loading="lazy" />
        )}
        <span className="text-sm font-semibold text-gray-900 truncate">{focusApp.name}</span>
        {focusApp.publisherName && (
          <span className="text-xs text-gray-500 truncate hidden sm:inline">{focusApp.publisherName}</span>
        )}
        <div className="flex gap-1">
          {focusGenres.map((g) => (
            <span key={g.id} className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">
              {g.name}
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
          aria-expanded={open && results.length > 0}
          aria-label="Search your game"
          placeholder="Search any game to find its competitors…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' && results[highlightedIndex]) {
              e.preventDefault();
              select(results[highlightedIndex]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="w-full rounded-xl border border-gray-300 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {searching ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-400">
              <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin" />
              Searching Sensor Tower…
            </p>
          ) : error ? (
            <p className="px-3 py-2.5 text-sm text-red-600">Search failed: {error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-gray-400">
              No game on Sensor Tower matches “{q.trim()}”.
            </p>
          ) : (
            <ul role="listbox">
              {results.map((app, i) => (
                <li key={app.appId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlightedIndex}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => select(app)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                      i === highlightedIndex ? 'bg-blue-50' : 'bg-white'
                    }`}
                  >
                    {app.iconUrl ? (
                      <img src={app.iconUrl} alt="" className="w-7 h-7 rounded-lg bg-gray-100 shrink-0" loading="lazy" />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-[10px] font-semibold text-gray-400">
                        {app.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{app.name}</span>
                      <span className="block text-xs text-gray-500 truncate">{app.publisherName || '—'}</span>
                    </span>
                    <span className="flex gap-1 shrink-0">
                      <GenreChips game={app} genres={genres} />
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
