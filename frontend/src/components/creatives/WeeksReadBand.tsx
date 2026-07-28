export interface CopyThisCard {
  hook: string;
  count: number;
  /** Up to 4 example thumbnails (poster URLs; may be null). */
  thumbs: (string | null)[];
}

export interface GapRow {
  key: string;
  compCount: number;
  you: number;
}

export interface RisingRow {
  label: string;
  delta: string;
  missing: boolean;
}

export interface WeeksReadBandProps {
  verdict: string | null;
  copyThis: CopyThisCard | null;
  gaps: GapRow[];
  gapTotal: number;
  rising: RisingRow[];
  risingTotal: number;
  onCopyThis: () => void;
  onShowGaps: () => void;
  onShowRising: () => void;
}

const ACTION_CLASS =
  'self-start rounded-lg border border-[#6f63d6] px-[11px] py-[5px] text-xs font-medium text-band-accent-2 transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-band-accent disabled:opacity-40';

const CARD_CLASS =
  'flex flex-col gap-2.5 rounded-lg border border-band-line bg-white/[0.03] p-3.5';

const KICKER_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.08em]';

/**
 * "This week's read" — the one saturated band on the page. Collapses the old
 * five analysis panels into a verdict plus three action cards, each a filter
 * shortcut over the gallery (wiring lives in the page).
 */
export function WeeksReadBand({
  verdict,
  copyThis,
  gaps,
  gapTotal,
  rising,
  risingTotal,
  onCopyThis,
  onShowGaps,
  onShowRising,
}: WeeksReadBandProps) {
  const maxGap = gaps.reduce((m, g) => Math.max(m, g.compCount), 1);

  return (
    <section className="bg-band px-7 pb-6 pt-[22px]">
      <div className="mb-1 flex items-center gap-2">
        <span className={`${KICKER_CLASS} text-band-accent`}>This week&apos;s read</span>
        <span
          className="h-px flex-1"
          style={{ background: 'linear-gradient(to right, rgba(167,155,234,.45), rgba(167,155,234,0))' }}
          aria-hidden
        />
      </div>

      {verdict && (
        <p className="mb-5 max-w-[1000px] text-[20px] leading-[1.45] text-band-ink [text-wrap:pretty]">{verdict}</p>
      )}

      <div className="grid gap-3.5 md:grid-cols-3">
        {/* COPY THIS */}
        <div className={CARD_CLASS}>
          <span className={`${KICKER_CLASS} text-band-accent`}>Copy this</span>
          {copyThis ? (
            <>
              <p className="text-[15px] font-medium text-band-ink">{copyThis.hook}</p>
              <p className="text-xs leading-[1.55] text-band-ink-2">
                The hook winning most across your set right now — {copyThis.count} live creative
                {copyThis.count === 1 ? '' : 's'} use it.
              </p>
              <div className="flex gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => {
                  const isOverflow = i === 3 && copyThis.count > 4;
                  const thumb = copyThis.thumbs[i];
                  return (
                    <span
                      key={i}
                      className="flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-md bg-[#302b52]"
                    >
                      {isOverflow ? (
                        <span className="text-[11px] font-medium text-band-accent">+{copyThis.count - 3}</span>
                      ) : thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : null}
                    </span>
                  );
                })}
              </div>
              <button type="button" onClick={onCopyThis} className={ACTION_CLASS}>
                Show these {copyThis.count}
              </button>
            </>
          ) : (
            <p className="text-xs leading-[1.55] text-band-ink-3">No hook classification for this week yet.</p>
          )}
        </div>

        {/* YOUR GAP */}
        <div className={CARD_CLASS}>
          <span className={`${KICKER_CLASS} text-alert`}>Your gap</span>
          {gaps.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {gaps.map((g) => (
                  <div key={g.key} className="flex items-center gap-2">
                    <span className="w-[78px] shrink-0 truncate text-[11px] text-band-ink-2">{g.key}</span>
                    <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#302b52]">
                      <span
                        className="block h-[5px] rounded-full bg-[#9184d9]"
                        style={{ width: `${Math.max((g.compCount / maxGap) * 100, 8)}%` }}
                      />
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-alert">you {g.you}</span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={onShowGaps} className={ACTION_CLASS} disabled={gapTotal === 0}>
                Show the {gapTotal}
              </button>
            </>
          ) : (
            <p className="text-xs leading-[1.55] text-band-ink-3">No format or length gaps — you cover what they run.</p>
          )}
        </div>

        {/* RISING */}
        <div className={CARD_CLASS}>
          <span className={`${KICKER_CLASS} text-band-accent`}>Rising</span>
          {rising.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {rising.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-band-ink">{r.label}</span>
                    <span className={`shrink-0 text-[11px] tabular-nums ${r.missing ? 'text-alert' : 'text-band-ink-3'}`}>
                      {r.delta}
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={onShowRising} className={ACTION_CLASS} disabled={risingTotal === 0}>
                Show {risingTotal} rising
              </button>
            </>
          ) : (
            <p className="text-xs leading-[1.55] text-band-ink-3">No rising concepts across the market this week.</p>
          )}
        </div>
      </div>
    </section>
  );
}
