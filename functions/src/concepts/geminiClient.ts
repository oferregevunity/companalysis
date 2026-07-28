import { VertexAI } from '@google-cloud/vertexai';
import { MOTIVATIONS } from '../creativeInsights/videoAnalysis';

/**
 * Concept generator — turns the competitor video analyses into ready-to-brief
 * creative concepts for the focus game, organized by the Ideation Strategy
 * pyramid (playbook slide 15): most output should be proven-adjacent (direct
 * copies of competitor winners + single-element iterations, ~70–80%), with a
 * smaller experimental share (~20%). Each concept maps onto the deck's Video
 * Brief fields so it can be pasted straight into a brief.
 *
 * Text-only: it consumes the already-computed video analyses + gaps + rising
 * concepts, so no video is sent here.
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/** Ideation tiers, ordered proven → experimental (playbook slide 15). */
export const IDEATION_TIERS = ['Direct Copy', 'Iteration', 'Strategic', 'Experimental'] as const;
export type IdeationTier = (typeof IDEATION_TIERS)[number];

/** One competitor creative the model can draw on, distilled from its video analysis. */
export interface ConceptSourceCreative {
  creativeId: string;
  appName: string;
  hookType: string;
  motivations: string[];
  hookMechanic: string;
  /** Short note on why it performs (winner explanation or predicted strength). */
  whatWorks?: string | null;
}

export interface ConceptGenInput {
  focusGameName: string;
  /** Hook types / motivations the focus game already runs — steer experimental away from these. */
  focusRuns?: string[];
  /** Competitor creatives (their top winning videos), the raw material for copies/iterations. */
  sources: ConceptSourceCreative[];
  /** Formats/hooks competitors run that the focus game does not (gap opportunities). */
  gaps?: string[];
  /** Cross-genre rising concepts (market pulse) — fuel for experimental ideas. */
  rising?: string[];
  /** How many concepts to generate. Default 5. */
  count?: number;
}

export interface GeneratedConcept {
  title: string;
  tier: IdeationTier;
  /** Primary player motivation (from the MOTIVATIONS taxonomy when possible). */
  motivation: string;
  hook: string;
  visualStyle: string;
  /** Intro / gameplay / end-screen guidance. */
  structure: string;
  /** Suggested length in seconds, or null. */
  lengthSec: number | null;
  /** creativeIds from `sources` that inspired this concept. */
  references: string[];
  /** Why this should work for the focus game — grounded in the sources/gaps. */
  rationale: string;
}

function coerceTier(v: unknown): IdeationTier {
  const s = String(v ?? '').trim();
  const hit = IDEATION_TIERS.find(t => t.toLowerCase() === s.toLowerCase());
  return hit ?? 'Iteration';
}

export function buildConceptPrompt(input: ConceptGenInput): string {
  const count = input.count ?? 5;
  const sourceLines = input.sources
    .map(
      s =>
        `- ${s.creativeId} — ${s.appName}: hook=${s.hookType}, motivations=[${s.motivations.join(', ')}], mechanic="${s.hookMechanic.slice(0, 160)}"${s.whatWorks ? `, works because ${s.whatWorks.slice(0, 120)}` : ''}`,
    )
    .join('\n');

  return `You are a mobile UA creative producer generating a creative brief backlog for "${input.focusGameName}".

Use the IDEATION STRATEGY pyramid (bias toward proven, ~70–80%, with ~20% experimental):
- "Direct Copy": replicate a competitor's winning concept closely for our game.
- "Iteration": take a winning concept and change ONE element (hook, visual sequence, or copy).
- "Strategic": combine winning patterns (e.g. a dominant hook + a rising theme) into a researched bet.
- "Experimental": a fresh angle inspired by trends the game is NOT already running.

COMPETITOR WINNING CREATIVES (your raw material — cite these ids in references):
${sourceLines || '(none)'}

${input.focusRuns?.length ? `OUR GAME ALREADY RUNS: ${input.focusRuns.join(', ')} — push experimental ideas AWAY from these.\n` : ''}${input.gaps?.length ? `GAPS (competitors run, we don't): ${input.gaps.join(', ')}\n` : ''}${input.rising?.length ? `RISING ACROSS THE MARKET: ${input.rising.join(', ')}\n` : ''}
Generate ${count} concepts. Roughly ${Math.max(1, Math.round(count * 0.75))} should be Direct Copy or Iteration, the rest Strategic/Experimental. Motivation should come from: ${MOTIVATIONS.join(' | ')}. Ground every concept in the data above — reference the competitor ids that inspired it. Do not invent competitors or performance numbers.

Respond in valid JSON with NO markdown fences, using EXACTLY this schema:
{
  "concepts": [
    {
      "title": "short concept name",
      "tier": "Direct Copy | Iteration | Strategic | Experimental",
      "motivation": "<one motivation>",
      "hook": "the first-3s hook angle",
      "visualStyle": "gameplay / UGC / themed / mixed, etc.",
      "structure": "intro -> gameplay -> end screen guidance in one line",
      "lengthSec": 20,
      "references": ["<creativeId(s) from the list above>"],
      "rationale": "1-2 sentences: why this works for our game, grounded in the sources/gaps"
    }
  ]
}`;
}

export function parseConceptResponse(raw: string): GeneratedConcept[] {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const obj = JSON.parse(cleaned) as { concepts?: unknown };
    if (!Array.isArray(obj.concepts)) return [];
    const out: GeneratedConcept[] = [];
    for (const c of obj.concepts as Array<Record<string, unknown>>) {
      const title = String(c.title ?? '').trim();
      if (!title) continue;
      const lenNum = typeof c.lengthSec === 'number' ? c.lengthSec : Number(c.lengthSec);
      out.push({
        title,
        tier: coerceTier(c.tier),
        motivation: String(c.motivation ?? '').trim(),
        hook: String(c.hook ?? '').trim(),
        visualStyle: String(c.visualStyle ?? '').trim(),
        structure: String(c.structure ?? '').trim(),
        lengthSec: Number.isFinite(lenNum) && lenNum > 0 ? Math.round(lenNum) : null,
        references: Array.isArray(c.references) ? c.references.map(String).map(s => s.trim()).filter(Boolean).slice(0, 5) : [],
        rationale: String(c.rationale ?? '').trim(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function generateConcepts(input: ConceptGenInput): Promise<{ concepts: GeneratedConcept[]; geminiError?: string }> {
  try {
    const result = await getModel().generateContent(buildConceptPrompt(input));
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { concepts: parseConceptResponse(text) };
  } catch (err) {
    return { concepts: [], geminiError: err instanceof Error ? err.message : String(err) };
  }
}
