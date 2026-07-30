import { useEffect } from 'react';
import type { CompareItem } from '../../lib/creativeCompare';

const PHASE_LABELS: Record<string, string> = { attention: 'Hook', content: 'Content', end: 'End' };

function formatLabel(f: CompareItem['format']): string {
  return f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1);
}

/** A labelled row with one value per side; tints when the two differ. */
function Row({ label, a, b, differ }: { label: string; a: React.ReactNode; b: React.ReactNode; differ?: boolean }) {
  return (
    <div className={`grid grid-cols-[92px_1fr_1fr] gap-x-3 py-1.5 ${differ ? 'bg-amber-50/60' : ''}`}>
      <span className="text-[11px] text-ink-muted">{label}</span>
      <span className="text-[12px] text-ink-2">{a}</span>
      <span className="text-[12px] text-ink-2">{b}</span>
    </div>
  );
}

/** Chips for a list, ringing items unique to this side (not in `others`). */
function ChipList({ items, others }: { items: string[]; others: string[] }) {
  if (items.length === 0) return <span className="text-ink-faint">—</span>;
  const otherSet = new Set(others.map((s) => s.toLowerCase()));
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((it) => {
        const unique = !otherSet.has(it.toLowerCase());
        return (
          <span
            key={it}
            className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
              unique ? 'border-accent-border bg-accent-tint text-accent-text' : 'border-line text-ink-2'
            }`}
          >
            {it}
          </span>
        );
      })}
    </span>
  );
}

function StrengthDots({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-faint">—</span>;
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= value ? 'bg-accent' : 'bg-hairline'}`} />
      ))}
    </span>
  );
}

function MediaHead({ item }: { item: CompareItem }) {
  return (
    <div>
      <div className="aspect-[4/5] w-full overflow-hidden rounded-lg bg-[#dfe0e8]">
        {item.poster ? (
          <img src={item.poster} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-ink-faint">No preview</div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {item.iconUrl ? (
          <img src={item.iconUrl} alt="" className="h-4 w-4 shrink-0 rounded" />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded bg-hairline" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.name}</span>
        {item.score != null && (
          <span className="shrink-0 rounded-md border border-accent-border bg-[rgba(255,255,255,0.94)] px-1.5 py-px text-[11px] font-semibold text-accent-text">
            {item.score}
          </span>
        )}
      </div>
    </div>
  );
}

export interface CreativeCompareModalProps {
  open: boolean;
  onClose: () => void;
  a: CompareItem | null;
  b: CompareItem | null;
}

export function CreativeCompareModal({ open, onClose, a, b }: CreativeCompareModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !a || !b) return null;

  const anyVideo = !!a.videoAnalysis || !!b.videoAnalysis;
  const segPhases: Array<'attention' | 'content' | 'end'> = ['attention', 'content', 'end'];
  const segText = (item: CompareItem, phase: string) =>
    item.videoAnalysis?.segments.find((s) => s.phase === phase)?.whatHappens ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(14,15,24,0.55)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Compare ${a.name} and ${b.name}`}
        className="relative flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-medium text-ink">Compare creatives</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-ink-muted hover:bg-hairline hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Media heads */}
          <div className="mb-3 grid grid-cols-[92px_1fr_1fr] gap-x-3">
            <span />
            <MediaHead item={a} />
            <MediaHead item={b} />
          </div>

          {/* Stats */}
          <div className="divide-y divide-hairline">
            <Row label="Format" a={formatLabel(a.format)} b={formatLabel(b.format)} differ={a.format !== b.format} />
            <Row label="Length" a={a.lengthLabel ?? '—'} b={b.lengthLabel ?? '—'} differ={a.lengthLabel !== b.lengthLabel} />
            <Row
              label="Networks"
              a={<ChipList items={a.networks} others={b.networks} />}
              b={<ChipList items={b.networks} others={a.networks} />}
            />
            <Row
              label="SoV"
              a={a.maxSharePct != null ? `${a.maxSharePct}%` : '—'}
              b={b.maxSharePct != null ? `${b.maxSharePct}%` : '—'}
              differ={a.maxSharePct !== b.maxSharePct}
            />
            <Row label="Live" a={`${a.durationDays}d`} b={`${b.durationDays}d`} differ={a.durationDays !== b.durationDays} />
            <Row
              label="Hook"
              a={a.hookType ?? '—'}
              b={b.hookType ?? '—'}
              differ={(a.hookType ?? '') !== (b.hookType ?? '')}
            />
            <Row
              label="Themes"
              a={<ChipList items={a.themes} others={b.themes} />}
              b={<ChipList items={b.themes} others={a.themes} />}
            />
            <Row
              label="Motivations"
              a={<ChipList items={a.motivations} others={b.motivations} />}
              b={<ChipList items={b.motivations} others={a.motivations} />}
            />
          </div>

          {/* Why it wins */}
          {(a.whyItWins || b.whyItWins) && (
            <div className="mt-3 grid grid-cols-[92px_1fr_1fr] gap-x-3">
              <span className="text-[11px] text-ink-muted">Why it wins</span>
              <p className="text-[12px] leading-[1.5] text-ink-2">{a.whyItWins ?? '—'}</p>
              <p className="text-[12px] leading-[1.5] text-ink-2">{b.whyItWins ?? '—'}</p>
            </div>
          )}

          {/* Video breakdown */}
          {anyVideo && (
            <div className="mt-4">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                Video breakdown <span className="font-normal text-ink-faint">(predicted)</span>
              </p>
              <div className="divide-y divide-hairline">
                <Row
                  label="Hook read"
                  a={<StrengthDots value={a.videoAnalysis?.predictedHookStrength ?? null} />}
                  b={<StrengthDots value={b.videoAnalysis?.predictedHookStrength ?? null} />}
                />
                <Row
                  label="Hold read"
                  a={<StrengthDots value={a.videoAnalysis?.predictedHoldStrength ?? null} />}
                  b={<StrengthDots value={b.videoAnalysis?.predictedHoldStrength ?? null} />}
                />
                {segPhases.map((phase) => {
                  const at = segText(a, phase);
                  const bt = segText(b, phase);
                  if (!at && !bt) return null;
                  return <Row key={phase} label={PHASE_LABELS[phase]} a={at ?? '—'} b={bt ?? '—'} />;
                })}
              </div>
              {(!a.videoAnalysis || !b.videoAnalysis) && (
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  One side isn&apos;t video-analyzed yet — open it and hit &ldquo;Analyze this video&rdquo; for a full read.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
