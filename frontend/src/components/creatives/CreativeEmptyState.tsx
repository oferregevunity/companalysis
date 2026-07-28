import { Fragment } from 'react';

export interface ActiveFilterDesc {
  label: string;
  /** AI hook/theme filters are highlighted in accent, per the design. */
  isAiTag: boolean;
}

export interface RecoveryAction {
  label: string;
  onApply: () => void;
}

export interface CreativeEmptyStateProps {
  activeFilters: ActiveFilterDesc[];
  recovery: RecoveryAction | null;
  onClearAll: () => void;
}

/**
 * Shown when the active filter combination yields no creatives. Names the
 * offending filters and offers a computed one-click recovery (the single filter
 * whose removal brings back the most results).
 */
export function CreativeEmptyState({ activeFilters, recovery, onClearAll }: CreativeEmptyStateProps) {
  const n = activeFilters.length;
  const headline = n > 1 ? `No creative matches all ${n} filters.` : 'No creative matches this filter.';

  return (
    <div className="max-w-[430px] py-10">
      <p className="text-base font-medium text-ink">{headline}</p>
      {n > 0 && (
        <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">
          Filtering by{' '}
          {activeFilters.map((f, i) => (
            <Fragment key={`${f.label}-${i}`}>
              <span className={f.isAiTag ? 'font-medium text-accent-text' : 'text-ink'}>{f.label}</span>
              {i < n - 1 ? (i === n - 2 ? ' and ' : ', ') : ''}
            </Fragment>
          ))}
          .{recovery ? ` ${recovery.label.replace(/ → .*/, '')} brings back more.` : ''}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {recovery && (
          <button
            type="button"
            onClick={recovery.onApply}
            className="rounded-lg border border-accent bg-transparent px-3 py-1.5 text-xs font-medium text-accent-text hover:bg-accent-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {recovery.label}
          </button>
        )}
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-[#faf9fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Clear all filters
        </button>
      </div>
    </div>
  );
}
