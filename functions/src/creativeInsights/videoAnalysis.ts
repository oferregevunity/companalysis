import { VertexAI } from '@google-cloud/vertexai';
import { HOOK_TYPES, type HookType } from './geminiClient';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

/**
 * Per-video creative analysis, structured around the "Iteration Loop" framework
 * from the Creative Producers Playbook (slide 14): a video ad is read as three
 * time segments — Attention/Hook (0–5s), Content (mid), End (last 2–5s) — plus
 * a checklist of iterable elements and the player motivations it targets.
 *
 * This is DISTINCT from the metadata-only `CreativeTag` in `geminiClient.ts`:
 * it requires the actual video to be sent to Gemini (see `videoStaging.ts`), and
 * is stored additively on the insight doc as `videoAnalyses[]` so the existing
 * `creativeTags` surface is untouched.
 *
 * IMPORTANT: we do NOT have real Hook Rate / Hold Rate (those are first-party UA
 * metrics we don't own). `predictedHookStrength` / `predictedHoldStrength` are
 * qualitative 1–5 predictions from the model and must be labeled as such in UI.
 */

/** Player motivations taxonomy (playbook slide 4). Gemini picks 1–3 per video. */
export const MOTIVATIONS = [
  'Action',
  'Achievement',
  'Mastery',
  'Social',
  'Creativity',
  'Destruction',
  'Completion',
  'Challenge',
  'Competition',
  'Design',
  'Excitement',
  'Power',
  'Strategy',
  'Collaboration',
  'Discovery',
] as const;

export type Motivation = (typeof MOTIVATIONS)[number];

/**
 * Iterable creative elements (playbook slide 14). A closed vocabulary so the
 * frontend can filter/aggregate; anything off-list is dropped at parse time.
 */
export const ITERABLE_ELEMENTS = [
  'Opening/Hook',
  'Mechanics',
  'Visual elements',
  'Animations',
  'Color scheme',
  'Audio',
  'Scene order',
  'Zoom level',
  'Gameplay capture',
  'Hand pointer',
  'Difficulty level',
  'Length',
  'Captions',
  'Voiceover',
  'UGC',
  'End twist',
  'CTA',
  'Layout complexity',
  'Store logo',
] as const;

export type IterableElement = (typeof ITERABLE_ELEMENTS)[number];

export type SegmentPhase = 'attention' | 'content' | 'end';

export interface CreativeSegment {
  phase: SegmentPhase;
  /** Seconds from the start of the video; null when the model can't place it. */
  startSec: number | null;
  endSec: number | null;
  /** 1–2 sentences on what happens in this segment. */
  whatHappens: string;
  /** Iterable elements notable in this segment (subset of ITERABLE_ELEMENTS). */
  notableElements: IterableElement[];
}

export interface VideoAnalysis {
  /** docId (`appId__creativeKey`). */
  creativeId: string;
  /** Hook type, now grounded in the actual video rather than inferred from copy. */
  hookType: HookType;
  /** 1–3 player motivations the ad targets. */
  motivations: Motivation[];
  /** What grabs attention in the first ~3s. */
  hookMechanic: string;
  segments: CreativeSegment[];
  cta: string | null;
  /** Qualitative PREDICTION (1–5), not a measured rate. Null when unscored. */
  predictedHookStrength: number | null;
  predictedHoldStrength: number | null;
  /** Concrete, copyable iteration ideas grounded in what the video does. */
  iterationIdeas: string[];
  themes: string[];
}

export interface VideoAnalysisInput {
  creativeId: string;
  appName: string;
  isFocusGame: boolean;
  videoDurationSec: number | null;
  title?: string | null;
  message?: string | null;
}

const SEGMENT_PHASES: readonly SegmentPhase[] = ['attention', 'content', 'end'];

/**
 * Prompt for analyzing ONE video. The caller attaches the video itself as a
 * multimodal part (see `analyzeCreativeVideo`); this text frames the rubric.
 */
export function buildVideoAnalysisPrompt(input: VideoAnalysisInput): string {
  const dur = input.videoDurationSec && input.videoDurationSec > 0 ? `~${Math.round(input.videoDurationSec)}s` : 'unknown length';
  const you = input.isFocusGame ? ' (this is the FOCUS game being analyzed)' : '';
  const copy = [
    input.title?.trim() ? `ad title="${input.title.trim().slice(0, 120)}"` : '',
    input.message?.trim() ? `ad text="${input.message.trim().slice(0, 200)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `You are a mobile UA creative strategist analyzing a single video ad for "${input.appName}"${you} (${dur}${copy ? `, ${copy}` : ''}).

Watch the video and analyze it with the ITERATION LOOP framework — a video ad has three segments:
- ATTENTION / HOOK (first 0–5s): what grabs attention. Drives whether users keep watching.
- CONTENT (the middle): mechanics, visuals, pacing, core experience. Drives whether users hold.
- END (last 2–5s): end twist, CTA, store logo, motivation closure.

Ground EVERY claim in what actually happens on screen. Do not invent scenes you cannot see.

HOOK TYPE — pick exactly one: ${HOOK_TYPES.join(' | ')}
PLAYER MOTIVATIONS — pick 1–3: ${MOTIVATIONS.join(' | ')}
ITERABLE ELEMENTS — use only these labels in notableElements: ${ITERABLE_ELEMENTS.join(' | ')}

predictedHookStrength / predictedHoldStrength are 1–5 QUALITATIVE PREDICTIONS of how well the opening grabs attention and the middle holds it — they are your judgement, NOT measured rates.

Respond in valid JSON with NO markdown fences, using EXACTLY this schema:
{
  "hookType": "<one hook label>",
  "motivations": ["<1-3 motivation labels>"],
  "hookMechanic": "1 sentence on what grabs attention in the first ~3 seconds",
  "segments": [
    { "phase": "attention", "startSec": 0, "endSec": 3, "whatHappens": "1-2 sentences", "notableElements": ["<iterable element labels>"] },
    { "phase": "content", "startSec": 3, "endSec": 12, "whatHappens": "1-2 sentences", "notableElements": [] },
    { "phase": "end", "startSec": 12, "endSec": 15, "whatHappens": "1-2 sentences", "notableElements": [] }
  ],
  "cta": "the call-to-action shown, or null",
  "predictedHookStrength": 4,
  "predictedHoldStrength": 3,
  "iterationIdeas": ["2-4 concrete, copyable ideas to iterate on this concept"],
  "themes": ["1-3 short theme tags, e.g. 'home renovation', 'boss fight'"]
}`;
}

function coerceHookType(v: unknown): HookType {
  const s = String(v ?? '').trim();
  return (HOOK_TYPES as readonly string[]).includes(s) ? (s as HookType) : 'Other';
}

function coerceMotivations(v: unknown): Motivation[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<string>(MOTIVATIONS);
  const out: Motivation[] = [];
  for (const raw of v) {
    const s = String(raw ?? '').trim();
    if (allowed.has(s) && !out.includes(s as Motivation)) out.push(s as Motivation);
    if (out.length >= 3) break;
  }
  return out;
}

function coerceElements(v: unknown): IterableElement[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<string>(ITERABLE_ELEMENTS);
  const out: IterableElement[] = [];
  for (const raw of v) {
    const s = String(raw ?? '').trim();
    if (allowed.has(s) && !out.includes(s as IterableElement)) out.push(s as IterableElement);
  }
  return out;
}

function coerceSec(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Clamp a 1–5 strength; null when absent/out of range. */
function coerceStrength(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

function coerceSegments(v: unknown): CreativeSegment[] {
  if (!Array.isArray(v)) return [];
  const out: CreativeSegment[] = [];
  for (const raw of v as Array<Record<string, unknown>>) {
    const phase = String(raw?.phase ?? '').trim() as SegmentPhase;
    if (!SEGMENT_PHASES.includes(phase)) continue;
    out.push({
      phase,
      startSec: coerceSec(raw.startSec),
      endSec: coerceSec(raw.endSec),
      whatHappens: String(raw.whatHappens ?? '').trim(),
      notableElements: coerceElements(raw.notableElements),
    });
  }
  return out;
}

function coerceStrings(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).map(s => s.trim()).filter(Boolean).slice(0, max);
}

export function parseVideoAnalysisResponse(raw: string, creativeId: string): VideoAnalysis | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const ctaRaw = String(obj.cta ?? '').trim();
    return {
      creativeId,
      hookType: coerceHookType(obj.hookType),
      motivations: coerceMotivations(obj.motivations),
      hookMechanic: String(obj.hookMechanic ?? '').trim(),
      segments: coerceSegments(obj.segments),
      cta: ctaRaw && ctaRaw.toLowerCase() !== 'null' ? ctaRaw : null,
      predictedHookStrength: coerceStrength(obj.predictedHookStrength),
      predictedHoldStrength: coerceStrength(obj.predictedHoldStrength),
      iterationIdeas: coerceStrings(obj.iterationIdeas, 4),
      themes: coerceStrings(obj.themes, 4),
    };
  } catch {
    return null;
  }
}

/** Runs a per-video prompt against a staged `gs://` URI. Injected for tests. */
export type VideoGenerate = (prompt: string, gsUri: string, mimeType: string) => Promise<string>;

/** Default multimodal generate via Vertex Gemini (video part + text prompt). */
export const vertexVideoGenerate: VideoGenerate = async (prompt, gsUri, mimeType) => {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ fileData: { fileUri: gsUri, mimeType } }, { text: prompt }] }],
  });
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

/** Analyze one staged video. Returns null when the model output can't be parsed. */
export async function analyzeCreativeVideo(
  input: VideoAnalysisInput,
  gsUri: string,
  mimeType: string,
  generate: VideoGenerate = vertexVideoGenerate,
): Promise<VideoAnalysis | null> {
  const raw = await generate(buildVideoAnalysisPrompt(input), gsUri, mimeType);
  return parseVideoAnalysisResponse(raw, input.creativeId);
}
