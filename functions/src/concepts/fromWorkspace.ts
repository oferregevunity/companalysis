import type { VideoAnalysis } from '../creativeInsights/videoAnalysis';
import type { CreativeTag } from '../creativeInsights/geminiClient';
import type { ConceptGenInput, ConceptSourceCreative } from './geminiClient';

/**
 * Pure bridge from a workspace insight doc to the concept generator's input.
 * Sources are the COMPETITORS' deep-analyzed winner videos (never the focus
 * game's own creatives — the point is to mine what rivals do that we don't);
 * `focusRuns` is what the focus game already runs, so the generator steers
 * experimental ideas away from it. `gaps`/`rising` are passed through from the
 * client (it already computes format/length gaps + the market-pulse rising set).
 */

/** docId is `${appId}__${creativeKey}`; the appId is everything before the first `__`. */
export function appIdFromCreativeId(creativeId: string): string {
  const i = creativeId.indexOf('__');
  return i > 0 ? creativeId.slice(0, i) : creativeId;
}

export interface WorkspaceConceptContext {
  focusAppId: string;
  focusGameName: string;
  /** Deep per-video analyses on the insight doc (top winner videos). */
  videoAnalyses: VideoAnalysis[];
  /** Metadata hook/theme tags on the insight doc. */
  creativeTags: Array<Pick<CreativeTag, 'creativeId' | 'hookType'>>;
  /** Winners, for the "why it works" note on each source. */
  winners: Array<{ creativeId: string; explanation: string }>;
  /** appId → display name (resolved from the appNames collection). */
  appNameById: Map<string, string>;
  gaps?: string[];
  rising?: string[];
  count?: number;
}

/**
 * Build the `ConceptGenInput` for a workspace. Returns `sources: []` when no
 * competitor video has been deep-analyzed yet — the caller should surface that
 * as "run analysis first" rather than generating ungrounded concepts.
 */
export function buildConceptInput(ctx: WorkspaceConceptContext): ConceptGenInput {
  const explanationById = new Map(ctx.winners.map(w => [w.creativeId, w.explanation]));

  const sources: ConceptSourceCreative[] = ctx.videoAnalyses
    .filter(va => appIdFromCreativeId(va.creativeId) !== ctx.focusAppId)
    .map(va => {
      const appId = appIdFromCreativeId(va.creativeId);
      const why = explanationById.get(va.creativeId)?.trim();
      return {
        creativeId: va.creativeId,
        appName: ctx.appNameById.get(appId) ?? appId,
        hookType: va.hookType,
        motivations: va.motivations,
        hookMechanic: va.hookMechanic,
        whatWorks: why ? why : null,
      };
    });

  // What the focus game already runs: its own hook types + the motivations of
  // its own analyzed videos. Steers experimental concepts away from these.
  const focusRuns = new Set<string>();
  const prefix = `${ctx.focusAppId}__`;
  for (const t of ctx.creativeTags) {
    if (t.creativeId.startsWith(prefix)) focusRuns.add(t.hookType);
  }
  for (const va of ctx.videoAnalyses) {
    if (!va.creativeId.startsWith(prefix)) continue;
    for (const m of va.motivations) focusRuns.add(m);
  }

  return {
    focusGameName: ctx.focusGameName,
    focusRuns: [...focusRuns],
    sources,
    gaps: ctx.gaps?.filter(Boolean),
    rising: ctx.rising?.filter(Boolean),
    count: ctx.count,
  };
}
