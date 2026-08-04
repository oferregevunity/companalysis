import { useMemo, useState } from 'react';
import { useOwnershipTransfers } from '../hooks/useOwnershipTransfers';
import type { OwnershipTransfer, TransferDeveloper } from '../types/ownershipTransfers';

type StoreFilter = 'all' | 'AppStore' | 'GooglePlay';
type TimeFilter = 'all' | '7d' | '30d' | '90d';

/** ISO 3166-1 alpha-2 → flag emoji (regional indicator pair). */
function flagEmoji(cc: string | null): string {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6;
  const up = cc.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

const TIME_MS: Record<Exclude<TimeFilter, 'all'>, number> = {
  '7d': 7 * 864e5,
  '30d': 30 * 864e5,
  '90d': 90 * 864e5,
};

/** Kept as a module helper (not in render) so the time read stays lint-clean. */
function withinRange(iso: string, time: TimeFilter): boolean {
  if (time === 'all') return true;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t >= Date.now() - TIME_MS[time];
}

function StoreBadge({ store }: { store: string }) {
  const isPlay = store === 'GooglePlay';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ${
        isPlay ? 'bg-[#e6f4ea] text-[#137333]' : 'bg-[#e8f0fe] text-[#1a73e8]'
      }`}
      title={store}
    >
      {isPlay ? 'Play' : 'iOS'}
    </span>
  );
}

function DevSide({ dev }: { dev: TransferDeveloper }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {dev.isPublisher ? <span title="Publisher" className="text-[#1a73e8]">◆</span> : null}
      <span className="font-medium text-[#202124]">{dev.name}</span>
      {dev.country ? <span aria-hidden>{flagEmoji(dev.country)}</span> : null}
    </span>
  );
}

function TransferRow({ t }: { t: OwnershipTransfer }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e8eaed] last:border-b-0 hover:bg-[#f8f9fa] transition-colors">
      {t.app.iconUrl ? (
        <img src={t.app.iconUrl} alt="" className="w-11 h-11 rounded-xl shrink-0 object-cover" loading="lazy" />
      ) : (
        <div className="w-11 h-11 rounded-xl shrink-0 bg-[#f1f3f4]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#202124] text-[14px] truncate">{t.app.name}</span>
          <StoreBadge store={t.app.store} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-[#5f6368] flex-wrap">
          <DevSide dev={t.from} />
          <span className="text-[#9aa0a6]">→</span>
          <DevSide dev={t.to} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[12px] text-[#5f6368]" title={new Date(t.detectedAt).toLocaleString()}>
          {relativeTime(t.detectedAt)}
        </div>
      </div>
    </div>
  );
}

export default function OwnershipTransfers() {
  const { transfers, loading, error } = useOwnershipTransfers();
  const [search, setSearch] = useState('');
  const [store, setStore] = useState<StoreFilter>('all');
  const [time, setTime] = useState<TimeFilter>('all');
  const [publishers, setPublishers] = useState<string[]>([]);

  const allPublishers = useMemo(() => {
    const s = new Set<string>();
    transfers.forEach((t) => t.trackedPublishers.forEach((p) => s.add(p)));
    return [...s].sort();
  }, [transfers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transfers.filter((t) => {
      if (store !== 'all' && t.app.store !== store) return false;
      if (!withinRange(t.detectedAt, time)) return false;
      if (publishers.length && !t.trackedPublishers.some((p) => publishers.includes(p))) return false;
      if (term) {
        const hay = `${t.app.name} ${t.from.name} ${t.to.name} ${t.app.storeId}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [transfers, search, store, time, publishers]);

  function togglePublisher(p: string) {
    setPublishers((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-9 h-9 rounded-lg bg-[#fef1d1] flex items-center justify-center text-[18px]">⇄</div>
        <h1 className="text-[22px] font-semibold text-[#202124] tracking-[-0.01em]">Ownership Transfers</h1>
      </div>
      <p className="text-[13px] text-[#5f6368] mb-5">
        Games moving between developers &amp; publishers across your tracked studios, newest detection first.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search app, developer…"
          className="h-9 px-3 rounded-lg border border-[#dadce0] text-[13px] w-56 focus:outline-none focus:border-primary-500"
        />
        <div className="inline-flex rounded-lg border border-[#dadce0] overflow-hidden">
          {(['all', 'AppStore', 'GooglePlay'] as StoreFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStore(s)}
              className={`px-3 h-9 text-[12px] font-medium transition-colors ${
                store === s ? 'bg-[#202124] text-white' : 'bg-white text-[#5f6368] hover:bg-[#f1f3f4]'
              }`}
            >
              {s === 'all' ? 'All' : s === 'AppStore' ? 'App Store' : 'Google Play'}
            </button>
          ))}
        </div>
        <select
          value={time}
          onChange={(e) => setTime(e.target.value as TimeFilter)}
          className="h-9 px-2.5 rounded-lg border border-[#dadce0] text-[13px] text-[#5f6368] bg-white focus:outline-none focus:border-primary-500"
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Publisher chips */}
      {allPublishers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {allPublishers.map((p) => {
            const on = publishers.includes(p);
            return (
              <button
                key={p}
                onClick={() => togglePublisher(p)}
                className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                  on
                    ? 'bg-primary-50 text-primary-700 border-primary-200'
                    : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f1f3f4]'
                }`}
              >
                {p}
              </button>
            );
          })}
          {publishers.length > 0 && (
            <button onClick={() => setPublishers([])} className="text-[12px] text-primary-600 hover:underline ml-1">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Feed */}
      <div className="bg-white rounded-xl border border-[#dadce0] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-[13px] text-[#5f6368]">Loading transfers…</div>
        ) : error ? (
          <div className="p-10 text-center text-[13px] text-[#c5221f]">{error}</div>
        ) : transfers.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-[#5f6368]">
            No transfers yet. Run the AppBird fetch (<code className="text-[12px]">ownershipTransfers/run</code>) to
            populate the feed.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-[#5f6368]">No transfers match your filters.</div>
        ) : (
          filtered.map((t) => <TransferRow key={t.key} t={t} />)
        )}
      </div>

      {!loading && !error && filtered.length > 0 && (
        <p className="mt-3 text-[12px] text-[#9aa0a6]">
          Showing {filtered.length} of {transfers.length} recent transfers.
        </p>
      )}
    </div>
  );
}
