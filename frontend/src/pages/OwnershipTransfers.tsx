import { useMemo, useState } from 'react';
import { useOwnershipTransfers } from '../hooks/useOwnershipTransfers';
import { AppDetailModal } from '../components/transfers/AppDetailModal';
import { flagEmoji, formatDateTime, relativeFromNow } from '../lib/appStoreFormat';
import type { OwnershipTransfer, TransferDeveloper } from '../types/ownershipTransfers';

type StoreFilter = 'all' | 'AppStore' | 'GooglePlay';
type TimeFilter = 'all' | '7d' | '30d' | '90d';

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

function TransferRow({ t, onOpen }: { t: OwnershipTransfer; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open details for ${t.app.name}`}
      className="group flex cursor-pointer items-center gap-3 px-4 py-3 border-b border-[#e8eaed] last:border-b-0 hover:bg-[#f8f9fa] focus:bg-[#f8f9fa] focus:outline-none transition-colors"
    >
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
        <div className="text-[12px] text-[#5f6368]" title={formatDateTime(t.detectedAt)}>
          {relativeFromNow(t.detectedAt, 'short')}
        </div>
      </div>
      <svg
        className="h-4 w-4 shrink-0 text-[#dadce0] transition-colors group-hover:text-[#5f6368]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </div>
  );
}

export default function OwnershipTransfers() {
  const { transfers, loading, error } = useOwnershipTransfers();
  const [search, setSearch] = useState('');
  const [store, setStore] = useState<StoreFilter>('all');
  const [time, setTime] = useState<TimeFilter>('all');
  const [publishers, setPublishers] = useState<string[]>([]);
  /** Store id of the app whose detail screen is open (null = closed). */
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);

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

  /** Every transfer for the open app — an app can change hands more than once. */
  const openTransfers = useMemo(
    () => (openStoreId ? transfers.filter((t) => t.app.storeId === openStoreId) : []),
    [transfers, openStoreId],
  );

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
          filtered.map((t) => <TransferRow key={t.key} t={t} onOpen={() => setOpenStoreId(t.app.storeId)} />)
        )}
      </div>

      {!loading && !error && filtered.length > 0 && (
        <p className="mt-3 text-[12px] text-[#9aa0a6]">
          Showing {filtered.length} of {transfers.length} recent transfers.
        </p>
      )}

      <AppDetailModal
        storeId={openStoreId}
        onClose={() => setOpenStoreId(null)}
        transfers={openTransfers}
        fallbackName={openTransfers[0]?.app.name}
        fallbackIconUrl={openTransfers[0]?.app.iconUrl}
      />
    </div>
  );
}
