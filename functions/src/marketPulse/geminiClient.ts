import { VertexAI } from '@google-cloud/vertexai';
import type { RisingCluster } from './aggregate';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/** A rising cluster enriched with an AI-written name + description. */
export interface NamedRisingConcept {
  title: string;
  description: string;
  kind: 'hook' | 'theme';
  label: string;
  hookType: string | null;
  themes: string[];
  wowGrowthPct: number | null;
  isNew: boolean;
  exampleCreativeIds: string[];
  genresSeenIn: string[];
}

/** Deterministic fallback (also the base we merge Gemini's title/description onto). */
export function clustersToConcepts(clusters: RisingCluster[]): NamedRisingConcept[] {
  return clusters.map((c) => ({
    title: c.label,
    description: '',
    kind: c.kind,
    label: c.label,
    hookType: c.kind === 'hook' ? c.label : null,
    themes: c.kind === 'theme' ? [c.label] : [],
    wowGrowthPct: c.wowGrowthPct,
    isNew: c.isNew,
    exampleCreativeIds: c.exampleCreativeIds,
    genresSeenIn: c.genresSeenIn,
  }));
}

export function buildMarketPulsePrompt(clusters: RisingCluster[], week: string): string {
  const lines = clusters
    .map((c) => {
      const growth = c.isNew ? 'NEW this week' : `${c.wowGrowthPct}% WoW`;
      return `- [${c.kind}] "${c.label}" — ${c.count} creatives (was ${c.prevCount}, ${growth}), genres=[${c.genresSeenIn.join(', ')}]`;
    })
    .join('\n');

  return `You are a mobile UA creative strategist. These hook types and themes are RISING across multiple game genres in week ${week} (ranked by week-over-week growth):

${lines || '(none)'}

For each item, give it a short, memorable concept name and a 1-sentence description of the visual/narrative/UA angle a game team could copy. Ground everything in the data — do not invent growth numbers or genres.

Respond in valid JSON with NO markdown fences, using EXACTLY this schema:
{
  "concepts": [
    { "label": "<the exact label from the list above>", "title": "short concept name", "description": "1 sentence on the creative angle" }
  ]
}`;
}

export function parseMarketPulseResponse(raw: string, clusters: RisingCluster[]): NamedRisingConcept[] {
  const base = clustersToConcepts(clusters);
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const obj = JSON.parse(cleaned) as { concepts?: unknown };
    const named = new Map<string, { title: string; description: string }>();
    if (Array.isArray(obj.concepts)) {
      for (const c of obj.concepts as Array<Record<string, unknown>>) {
        const label = String(c.label ?? '').trim();
        if (!label) continue;
        named.set(label, {
          title: String(c.title ?? '').trim() || label,
          description: String(c.description ?? '').trim(),
        });
      }
    }
    return base.map((concept) => {
      const n = named.get(concept.label);
      return n ? { ...concept, title: n.title, description: n.description } : concept;
    });
  } catch {
    return base;
  }
}

export async function nameRisingConcepts(
  clusters: RisingCluster[],
  week: string,
): Promise<{ concepts: NamedRisingConcept[]; geminiError?: string }> {
  if (clusters.length === 0) return { concepts: [] };
  try {
    const model = getModel();
    const result = await model.generateContent(buildMarketPulsePrompt(clusters, week));
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { concepts: parseMarketPulseResponse(text, clusters) };
  } catch (err) {
    return {
      concepts: clustersToConcepts(clusters),
      geminiError: err instanceof Error ? err.message : String(err),
    };
  }
}
