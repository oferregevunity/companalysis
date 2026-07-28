import { useEffect, useMemo, useState } from 'react';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import type { CreativeInsightDoc, GeneratedConcept, IdeationTier } from '../../types/creatives';
import { IDEATION_TIERS } from '../../types/creatives';
import { appIdFromCreativeId } from '../../lib/creativeFilters';
import { buildConceptBrief } from '../../lib/creativeBrief';
import { generateWorkspaceConcepts } from '../../lib/creativesApi';

const TIER_BADGE: Record<IdeationTier, string> = {
  'Direct Copy': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Iteration: 'border-blue-200 bg-blue-50 text-blue-700',
  Strategic: 'border-amber-200 bg-amber-50 text-amber-700',
  Experimental: 'border-violet-200 bg-violet-50 text-violet-700',
};

const TIER_HINT: Record<IdeationTier, string> = {
  'Direct Copy': 'Replicate a proven competitor winner',
  Iteration: 'A winner with one element changed',
  Strategic: 'Combine proven patterns into a bet',
  Experimental: 'A fresh angle you don’t run yet',
};

const COUNTS = [3, 5, 8] as const;

function ConceptCard({
  concept,
  refNames,
  focusGameName,
}: {
  concept: GeneratedConcept;
  refNames: Map<string, string>;
  focusGameName: string;
}) {
  const [copied, setCopied] = useState(false);
  const refs = [...new Set(concept.references.map((id) => refNames.get(id) ?? id))];

  const onCopy = () => {
    const md = buildConceptBrief(concept, focusGameName, refNames);
    void navigator.clipboard?.writeText(md).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3.5">
      <div className="mb-1.5 flex items-start gap-2">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TIER_BADGE[concept.tier]}`}>
          {concept.tier}
        </span>
        <h3 className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-ink">{concept.title}</h3>
        {concept.lengthSec != null && (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{concept.lengthSec}s</span>
        )}
      </div>

      <div className="space-y-1.5 text-[12px] leading-[1.55] text-ink-2">
        {concept.motivation && (
          <span className="inline-block rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
            {concept.motivation}
          </span>
        )}
        {concept.hook && (
          <p>
            <span className="font-medium text-ink">Hook:</span> {concept.hook}
          </p>
        )}
        {concept.visualStyle && (
          <p>
            <span className="font-medium text-ink">Visual:</span> {concept.visualStyle}
          </p>
        )}
        {concept.structure && (
          <p>
            <span className="font-medium text-ink">Structure:</span> {concept.structure}
          </p>
        )}
        {concept.rationale && <p className="text-ink-muted">{concept.rationale}</p>}
        {refs.length > 0 && (
          <p className="text-[11px] text-ink-faint">Inspired by {refs.join(', ')}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onCopy}
        className="mt-2.5 rounded-lg border border-accent bg-transparent px-2.5 py-1 text-[11px] font-medium text-accent-text hover:bg-accent-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {copied ? 'Copied ✓' : 'Copy as brief'}
      </button>
    </div>
  );
}

export interface ConceptGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  insightDoc: CreativeInsightDoc | null;
  focusAppId: string;
  focusGameName: string;
  scopeId: string;
  week: string;
  /** Format/length gap labels (from the band) — steers the generator. */
  gaps: string[];
  /** Rising concept labels the focus game isn't running — fuel for experimental. */
  rising: string[];
  /** appId → display entry, to resolve reference creativeIds to game names. */
  appNames: Map<string, AppNameMapEntry>;
}

export function ConceptGeneratorModal({
  open,
  onClose,
  insightDoc,
  focusAppId,
  focusGameName,
  scopeId,
  week,
  gaps,
  rising,
  appNames,
}: ConceptGeneratorModalProps) {
  const [local, setLocal] = useState<GeneratedConcept[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<(typeof COUNTS)[number]>(5);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Prefer the just-returned local result, else whatever is persisted on the doc.
  const concepts = local ?? insightDoc?.concepts ?? [];
  const hasConcepts = concepts.length > 0;

  // Resolve reference creativeIds (docIds) → game names for the brief + card.
  const refNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of concepts) {
      for (const id of c.references) {
        const appId = appIdFromCreativeId(id);
        const name = appNames.get(appId)?.name;
        if (name) m.set(id, name);
      }
    }
    return m;
  }, [concepts, appNames]);

  const grouped = useMemo(
    () => IDEATION_TIERS.map((tier) => ({ tier, items: concepts.filter((c) => c.tier === tier) })).filter((g) => g.items.length > 0),
    [concepts],
  );

  const onGenerate = () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    void generateWorkspaceConcepts({ scopeId, week, focusAppId, focusGameName, gaps, rising, count }).then(
      (res) => {
        setGenerating(false);
        if (res.ok && res.concepts.length > 0) setLocal(res.concepts);
        else setError(res.reason || res.geminiError || 'Generation failed.');
      },
      (err) => {
        setGenerating(false);
        setError(err instanceof Error ? err.message : 'Generation failed.');
      },
    );
  };

  if (!open) return null;

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
        aria-label={`Concept ideas for ${focusGameName}`}
        className="relative flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium text-ink">Concept ideas</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Grounded in your competitors&apos; analyzed winning videos, biased toward proven ideas.
            </p>
          </div>
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-line" role="group" aria-label="Count">
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={generating}
                onClick={() => setCount(n)}
                className={`px-2.5 py-[5px] text-xs transition-colors disabled:opacity-50 ${
                  n === count ? 'bg-accent-tint font-medium text-accent-text' : 'bg-surface text-ink-2 hover:bg-[#faf9fe]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="shrink-0 rounded-lg border border-accent bg-transparent px-3 py-[5px] text-xs font-medium text-accent-text hover:bg-accent-tint disabled:opacity-60"
          >
            {generating ? 'Generating…' : hasConcepts ? 'Regenerate' : `Generate ${count}`}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-ink-muted hover:bg-hairline hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {generating && !hasConcepts ? (
            <div className="py-16 text-center text-sm text-ink-muted">Generating {count} concepts from your winning set…</div>
          ) : hasConcepts ? (
            <div className="space-y-5">
              {grouped.map(({ tier, items }) => (
                <div key={tier}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{tier}</span>
                    <span className="text-[11px] text-ink-faint">{TIER_HINT[tier]}</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {items.map((c, i) => (
                      <ConceptCard key={`${c.title}-${i}`} concept={c} refNames={refNames} focusGameName={focusGameName} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-[#faf9fe] p-8 text-center">
              <p className="mx-auto mb-3 max-w-[420px] text-sm text-ink-muted">
                Turn your competitors&apos; winning videos into a ready-to-brief concept backlog — direct copies,
                single-element iterations, and a few experimental bets.
              </p>
              <button
                type="button"
                onClick={onGenerate}
                disabled={generating}
                className="rounded-lg border border-accent bg-transparent px-4 py-2 text-xs font-medium text-accent-text hover:bg-accent-tint disabled:opacity-60"
              >
                {generating ? 'Generating…' : `Generate ${count} concepts`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
