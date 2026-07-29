import type { Filters } from '../../lib/creativeFilters';

export type GalleryTab = 'winners' | 'new' | 'gaps' | 'all';

const TAB_LABELS: Record<GalleryTab, string> = {
  winners: 'Winners',
  new: 'New this week',
  gaps: 'Your gaps',
  all: 'All',
};

const TAB_ORDER: GalleryTab[] = ['winners', 'new', 'gaps', 'all'];

const SORT_LABELS: Record<Filters['sort'], string> = {
  score: 'Score',
  duration: 'Duration',
  firstSeen: 'First seen',
  sov: 'Share of voice',
};

export interface AiChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface GalleryTabsProps {
  activeTab: GalleryTab;
  counts: Record<GalleryTab, number>;
  onSelect: (tab: GalleryTab) => void;
  aiChips: AiChip[];
  sort: Filters['sort'];
  onSortChange: (sort: Filters['sort']) => void;
  groupVariants: boolean;
  onToggleGroupVariants: (next: boolean) => void;
}

export function GalleryTabs({
  activeTab,
  counts,
  onSelect,
  aiChips,
  sort,
  onSortChange,
  groupVariants,
  onToggleGroupVariants,
}: GalleryTabsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2.5">
      <div className="flex items-center gap-[18px]">
        {TAB_ORDER.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onSelect(tab)}
              className={`-mb-2.5 pb-2.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                active ? 'font-medium text-ink shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {TAB_LABELS[tab]} <span className="tabular-nums text-ink-faint">{counts[tab]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted" title="Collapse the same creative run across multiple games into one tile">
          <input
            type="checkbox"
            checked={groupVariants}
            onChange={(e) => onToggleGroupVariants(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line text-accent focus:ring-accent"
          />
          Group variants
        </label>
        {aiChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.onRemove}
            title="Remove filter"
            className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-tint px-2 py-[3px] text-[11px] font-medium text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {chip.label}
            <span aria-hidden>×</span>
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as Filters['sort'])}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink focus:border-accent focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as Filters['sort'][]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
