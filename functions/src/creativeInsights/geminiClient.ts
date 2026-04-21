import { VertexAI } from '@google-cloud/vertexai';
import type { QueryableAdNetwork, CreativeFormat } from '../adIntel/types';
import type { SubScores } from './scoringEngine';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
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
}

export interface CreativeCandidateInput {
  creativeId: string;
  appId: string;
  appName: string;
  format: CreativeFormat;
  networks: QueryableAdNetwork[];
  score: number;
}

export interface BuildPromptInput {
  genreName: string;
  week: string;
  winners: CreativeWinnerInput[];
  conceptCandidates: CreativeCandidateInput[];
  watchCandidates: CreativeCandidateInput[];
}

export interface ParsedCreativeResponse {
  summary: string;
  winners: Array<{ creativeId: string; explanation: string }>;
  emergingConcepts: Array<{ title: string; description: string; exampleCreativeIds: string[] }>;
  watchList: Array<{ creativeId: string; reason: string }>;
}

export function buildCreativePrompt(input: BuildPromptInput): string {
  const winnerLines = input.winners
    .map(
      (w, i) =>
        `#${i + 1} ${w.creativeId} — app=${w.appName} (${w.publisherName}) fmt=${w.format} networks=[${w.networks.join(', ')}] score=${w.score}/100 sub=[L=${w.subScores.longevity}, NB=${w.subScores.networkBreadth}, IM=${w.subScores.impressionMomentum}, FAP=${w.subScores.freshnessAdjustedPersistence}] firstSeen=${w.firstSeen} dur=${w.durationDays}d`,
    )
    .join('\n');
  const conceptLines = input.conceptCandidates
    .map(
      c =>
        `- ${c.creativeId} — app=${c.appName} fmt=${c.format} networks=[${c.networks.join(', ')}] score=${c.score}`,
    )
    .join('\n');
  const watchLines = input.watchCandidates
    .map(
      c =>
        `- ${c.creativeId} — app=${c.appName} fmt=${c.format} networks=[${c.networks.join(', ')}] score=${c.score}`,
    )
    .join('\n');

  return `You are a mobile UA creative strategist. Analyze the top-performing ad creatives for the "${input.genreName}" genre in week ${input.week}.

TOP WINNING CREATIVES:
${winnerLines || '(none)'}

CONCEPT CANDIDATES (next-tier — look for emerging themes):
${conceptLines || '(none)'}

WATCH LIST (creatives to monitor):
${watchLines || '(none)'}

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
  ]
}

Ground every claim in the data provided. Do not invent networks, durations, or scores.`;
}

export function parseCreativeResponse(raw: string): ParsedCreativeResponse {
  const empty: ParsedCreativeResponse = { summary: '', winners: [], emergingConcepts: [], watchList: [] };
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
      geminiError: err instanceof Error ? err.message : String(err),
    };
  }
}
