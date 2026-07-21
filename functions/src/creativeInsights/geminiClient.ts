import { VertexAI } from '@google-cloud/vertexai';
import type { QueryableAdNetwork, CreativeFormat } from '../adIntel/types';
import type { SubScores } from './scoringEngine';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/**
 * Fixed UA hook taxonomy. Gemini must pick one per creative; anything else is
 * coerced to 'Other' at parse time so the frontend can rely on the set.
 */
export const HOOK_TYPES = [
  'Fail & Frustration',
  'Satisfying / ASMR',
  'Challenge / Can You Beat',
  'Narrative / Story',
  'Tutorial / How-To',
  'UGC / Reaction',
  'Before & After',
  'Gameplay Showcase',
  'Reward / Progression',
  'Comparison / VS',
  'Other',
] as const;

export type HookType = (typeof HOOK_TYPES)[number];

export interface CreativeTag {
  creativeId: string;
  hookType: HookType;
  themes: string[];
}

export interface CreativeWinnerInput {
  creativeId: string; // caller may use docId (`${appId}__${creativeKey}`)
  appId: string;
  appName: string;
  publisherName: string;
  networks: QueryableAdNetwork[];
  format: CreativeFormat;
  durationDays: number;
  firstSeen: string;
  score: number;
  subScores: SubScores;
  title?: string | null;
  message?: string | null;
}

export interface CreativeCandidateInput {
  creativeId: string;
  appId: string;
  appName: string;
  format: CreativeFormat;
  networks: QueryableAdNetwork[];
  score: number;
  title?: string | null;
  message?: string | null;
}

export interface BuildPromptInput {
  genreName: string;
  week: string;
  winners: CreativeWinnerInput[];
  conceptCandidates: CreativeCandidateInput[];
  watchCandidates: CreativeCandidateInput[];
  /** When set, creatives from this appId are the focus game ("you") — used to flag concept gaps. */
  focusAppId?: string;
}

export interface ParsedCreativeResponse {
  summary: string;
  winners: Array<{ creativeId: string; explanation: string }>;
  emergingConcepts: Array<{ title: string; description: string; exampleCreativeIds: string[] }>;
  watchList: Array<{ creativeId: string; reason: string }>;
  creativeTags: CreativeTag[];
}

function adTextSuffix(title?: string | null, message?: string | null): string {
  const parts: string[] = [];
  if (title?.trim()) parts.push(`title="${title.trim().slice(0, 120)}"`);
  if (message?.trim()) parts.push(`text="${message.trim().slice(0, 200)}"`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function buildCreativePrompt(input: BuildPromptInput): string {
  const you = (appId: string) => (input.focusAppId && appId === input.focusAppId ? ' [YOU]' : '');
  const winnerLines = input.winners
    .map(
      (w, i) =>
        `#${i + 1} ${w.creativeId} — app=${w.appName}${you(w.appId)} (${w.publisherName}) fmt=${w.format} networks=[${w.networks.join(', ')}] score=${w.score}/100 sub=[L=${w.subScores.longevity}, NB=${w.subScores.networkBreadth}, IM=${w.subScores.impressionMomentum}, FAP=${w.subScores.freshnessAdjustedPersistence}] firstSeen=${w.firstSeen} dur=${w.durationDays}d${adTextSuffix(w.title, w.message)}`,
    )
    .join('\n');
  const conceptLines = input.conceptCandidates
    .map(
      c =>
        `- ${c.creativeId} — app=${c.appName}${you(c.appId)} fmt=${c.format} networks=[${c.networks.join(', ')}] score=${c.score}${adTextSuffix(c.title, c.message)}`,
    )
    .join('\n');
  const watchLines = input.watchCandidates
    .map(
      c =>
        `- ${c.creativeId} — app=${c.appName}${you(c.appId)} fmt=${c.format} networks=[${c.networks.join(', ')}] score=${c.score}${adTextSuffix(c.title, c.message)}`,
    )
    .join('\n');

  const focusNote = input.focusAppId
    ? `\nCreatives marked [YOU] belong to the focus game being analyzed. In emergingConcepts, PRIORITIZE concepts that competitors run but the [YOU] game does NOT — these are gaps the focus game is missing. When a concept is absent from the [YOU] game, say so explicitly in its description.\n`
    : '';

  return `You are a mobile UA creative strategist. Analyze the top-performing ad creatives for the "${input.genreName}" genre in week ${input.week}.${focusNote}

TOP WINNING CREATIVES:
${winnerLines || '(none)'}

CONCEPT CANDIDATES (next-tier — look for emerging themes):
${conceptLines || '(none)'}

WATCH LIST (creatives to monitor):
${watchLines || '(none)'}

HOOK TYPE TAXONOMY (use exactly one of these labels per creative):
${HOOK_TYPES.join(' | ')}

Respond in valid JSON with NO markdown fences, using EXACTLY this schema:
{
  "summary": "2-3 sentence summary of the week's creative trends",
  "winners": [
    { "creativeId": "<one of the ids above>", "explanation": "1-2 sentences on why it is winning, citing networks, longevity, and any sub-scores" }
  ],
  "emergingConcepts": [
    { "title": "short concept name", "description": "1-2 sentences describing the visual/narrative/UA hook", "exampleCreativeIds": ["<ids from CONCEPT CANDIDATES or WINNERS>"] }
  ],
  "watchList": [
    { "creativeId": "<one of WATCH LIST ids>", "reason": "1 sentence why it is worth monitoring" }
  ],
  "creativeTags": [
    { "creativeId": "<any id from WINNERS or CONCEPT CANDIDATES>", "hookType": "<one taxonomy label>", "themes": ["1-3 short theme tags, e.g. 'home renovation', 'boss fight', 'jackpot win'"] }
  ]
}

Tag EVERY winner and concept candidate in creativeTags, inferring the hook from the app, format, networks, and any ad title/text provided. Ground every claim in the data provided. Do not invent networks, durations, or scores.`;
}

function coerceHookType(v: unknown): HookType {
  const s = String(v ?? '').trim();
  return (HOOK_TYPES as readonly string[]).includes(s) ? (s as HookType) : 'Other';
}

export function parseCreativeResponse(raw: string): ParsedCreativeResponse {
  const empty: ParsedCreativeResponse = { summary: '', winners: [], emergingConcepts: [], watchList: [], creativeTags: [] };
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const asArr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      winners: asArr<{ creativeId?: unknown; explanation?: unknown }>(obj.winners).map(w => ({
        creativeId: String(w.creativeId ?? ''),
        explanation: String(w.explanation ?? ''),
      })),
      emergingConcepts: asArr<{ title?: unknown; description?: unknown; exampleCreativeIds?: unknown }>(obj.emergingConcepts).map(c => ({
        title: String(c.title ?? ''),
        description: String(c.description ?? ''),
        exampleCreativeIds: Array.isArray(c.exampleCreativeIds) ? c.exampleCreativeIds.map(String) : [],
      })),
      watchList: asArr<{ creativeId?: unknown; reason?: unknown }>(obj.watchList).map(w => ({
        creativeId: String(w.creativeId ?? ''),
        reason: String(w.reason ?? ''),
      })),
      creativeTags: asArr<{ creativeId?: unknown; hookType?: unknown; themes?: unknown }>(obj.creativeTags)
        .filter(t => t && String(t.creativeId ?? '').length > 0)
        .map(t => ({
          creativeId: String(t.creativeId),
          hookType: coerceHookType(t.hookType),
          themes: Array.isArray(t.themes) ? t.themes.map(String).filter(Boolean).slice(0, 4) : [],
        })),
    };
  } catch {
    return empty;
  }
}

export async function generateCreativeInsights(
  input: BuildPromptInput,
): Promise<ParsedCreativeResponse & { geminiError?: string }> {
  try {
    const model = getModel();
    const prompt = buildCreativePrompt(input);
    const result = await model.generateContent(prompt);
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseCreativeResponse(text);
  } catch (err) {
    return {
      summary: '',
      winners: [],
      emergingConcepts: [],
      watchList: [],
      creativeTags: [],
      geminiError: err instanceof Error ? err.message : String(err),
    };
  }
}
