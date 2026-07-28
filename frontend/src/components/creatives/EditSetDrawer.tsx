import { useEffect } from 'react';
import { CompetitorRail, type CompetitorRailProps } from './CompetitorRail';

export type EditSetDrawerProps = CompetitorRailProps & {
  open: boolean;
  onClose: () => void;
};

/**
 * Slide-over that houses the full competitor rail (curation checkboxes, per-app
 * fetch status, add/remove, country, Analyze). In the redesign the header shows
 * only a compact chip strip; the heavy editing surface lives here behind
 * "Edit set". The rail itself is reused unchanged.
 */
export function EditSetDrawer({ open, onClose, ...railProps }: EditSetDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(14,15,24,0.55)]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit competitor set"
        className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-[15px] font-medium text-ink">Edit competitor set</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-ink-muted hover:bg-hairline hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">
          <CompetitorRail {...railProps} />
        </div>
      </div>
    </div>
  );
}
