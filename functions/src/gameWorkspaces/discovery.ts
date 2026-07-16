import { VertexAI } from '@google-cloud/vertexai';
import type { AppStoreDetail, SearchedApp } from '../sensorTower/client';
import type { CompetitorRow } from '../sensorTower/competitors';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/** One discovered competitor, resolved to a real Sensor Tower unified app. */
export interface DiscoveredCompetitor {
  appId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl: string | null;
  /** Last complete month's store revenue when known (category backfill rows). */
  revenue: number | null;
  downloads: number | null;
  /** Why this app is in the list. */
  source: 'ai' | 'category';
  /** Gemini's one-line rationale (ai rows only). */
  reason: string | null;
}

export interface DiscoveryPromptInput {
  name: string;
  publisherName: string;
  subtitle: string | null;
  description: string | null;
  categories: string[];
  lastMonthDownloads: number | null;
  lastMonthRevenue: number | null;
}

export function buildDiscoveryPrompt(input: DiscoveryPromptInput): string {
  const desc = input.description ? input.description.replace(/\s+/g, ' ').slice(0, 900) : '(none)';
  return `You are a mobile games UA/market analyst. Identify the closest real competitors of this game — games competing for the same players and the same ad audience (similar core mechanic, theme, or audience), not merely the same store category.

GAME:
name: ${input.name}
publisher: ${input.publisherName || '(unknown)'}
subtitle: ${input.subtitle ?? '(none)'}
store categories: ${input.categories.join(', ') || '(unknown)'}
last month: ${input.lastMonthDownloads ?? '?'} downloads, $${input.lastMonthRevenue ?? '?'} revenue
store description: ${desc}

List 12 competitors, strongest first. Prefer live, actively-marketed mobile games of a comparable scale. Do NOT include the game itself or other titles by the same publisher unless they truly compete.

Respond in valid JSON with NO markdown fences, using EXACTLY this schema:
{
  "competitors": [
    { "name": "exact store title", "publisher": "publisher name if known, else empty string", "reason": "one short sentence why it competes" }
  ]
}`;
}

export interface DiscoveryCandidate {
  name: string;
  publisher: string;
  reason: string;
}

export function parseDiscoveryResponse(raw: string): DiscoveryCandidate[] {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    if (!Array.isArray(obj.competitors)) return [];
    return (obj.competitors as Array<Record<string, unknown>>)
      .map(c => ({
        name: String(c?.name ?? '').trim(),
        publisher: String(c?.publisher ?? '').trim(),
        reason: String(c?.reason ?? '').trim(),
      }))
      .filter(c => c.name.length > 0)
      .slice(0, 15);
  } catch {
    return [];
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Pick the search hit that best matches a Gemini-suggested name. Exact
 * normalized title match wins; then title prefix/containment; publisher match
 * breaks ties. Returns null when nothing plausibly matches (Gemini invented
 * a title, or search returned unrelated apps).
 */
export function pickBestMatch(
  candidate: DiscoveryCandidate,
  hits: SearchedApp[],
): SearchedApp | null {
  const want = normalize(candidate.name);
  const wantPub = normalize(candidate.publisher);
  let best: { hit: SearchedApp; score: number } | null = null;
  for (const hit of hits) {
    const got = normalize(hit.name);
    let score = 0;
    if (got === want) score = 3;
    else if (got.startsWith(want) || want.startsWith(got)) score = 2;
    else if (got.includes(want) || want.includes(got)) score = 1;
    else continue;
    if (wantPub && normalize(hit.publisherName).includes(wantPub)) score += 0.5;
    if (!best || score > best.score) best = { hit, score };
  }
  return best?.hit ?? null;
}

export interface DiscoverDeps {
  focusAppId: string;
  detail: DiscoveryPromptInput;
  /** Category id for the revenue backfill (null skips backfill). */
  category: string | null;
  country: string;
  callGemini: (prompt: string) => Promise<string>;
  searchApps: (term: string) => Promise<SearchedApp[]>;
  fetchCategoryTop: (category: string, country: string) => Promise<CompetitorRow[]>;
  /** Bounded parallelism for name-resolution search calls. */
  concurrency?: number;
  targetCount?: number;
}

/**
 * AI-grounded competitor discovery: Gemini proposes real competitor titles
 * from the game's store listing, each is resolved to a unified app via
 * Sensor Tower search, and category top-revenue apps backfill the list.
 */
export async function discoverCompetitorsWithDeps(deps: DiscoverDeps): Promise<DiscoveredCompetitor[]> {
  const { focusAppId, detail, category, country, callGemini, searchApps, fetchCategoryTop } = deps;
  const concurrency = deps.concurrency ?? 5;
  const targetCount = deps.targetCount ?? 20;

  let candidates: DiscoveryCandidate[] = [];
  try {
    candidates = parseDiscoveryResponse(await callGemini(buildDiscoveryPrompt(detail)));
  } catch (err) {
    console.warn('Competitor discovery Gemini call failed, falling back to category top:', err);
  }

  // Resolve Gemini's titles to real unified apps, preserving rank order.
  const resolved: Array<DiscoveredCompetitor | null> = new Array(candidates.length).fill(null);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= candidates.length) return;
      const c = candidates[i];
      try {
        const hit = pickBestMatch(c, await searchApps(c.name));
        if (hit && hit.appId !== focusAppId) {
          resolved[i] = {
            appId: hit.appId,
            name: hit.name,
            publisherName: hit.publisherName,
            iosAppId: hit.iosAppId,
            androidAppId: hit.androidAppId,
            iconUrl: hit.iconUrl,
            revenue: null,
            downloads: null,
            source: 'ai',
            reason: c.reason || null,
          };
        }
      } catch (err) {
        console.warn(`Competitor resolution failed for "${c.name}":`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));

  const out: DiscoveredCompetitor[] = [];
  const seen = new Set<string>([focusAppId]);
  for (const r of resolved) {
    if (r && !seen.has(r.appId)) {
      seen.add(r.appId);
      out.push(r);
    }
  }

  // Backfill with category top-by-revenue until we have a healthy candidate pool.
  if (category && out.length < targetCount) {
    try {
      const top = await fetchCategoryTop(category, country);
      for (const app of top) {
        if (out.length >= targetCount) break;
        if (seen.has(app.appId)) {
          // Category data enriches an AI row with revenue/downloads.
          const existing = out.find(o => o.appId === app.appId);
          if (existing) {
            existing.revenue = app.revenue;
            existing.downloads = app.downloads;
          }
          continue;
        }
        seen.add(app.appId);
        out.push({
          appId: app.appId,
          name: app.name,
          publisherName: app.publisherName,
          iosAppId: app.iosAppId,
          androidAppId: app.androidAppId,
          iconUrl: app.iconUrl,
          revenue: app.revenue,
          downloads: app.downloads,
          source: 'category',
          reason: null,
        });
      }
      // Enrich AI rows that also rank in the category top list.
      const byId = new Map(top.map(t => [t.appId, t]));
      for (const o of out) {
        if (o.revenue === null) {
          const t = byId.get(o.appId);
          if (t) {
            o.revenue = t.revenue;
            o.downloads = t.downloads;
          }
        }
      }
    } catch (err) {
      console.warn('Category backfill failed:', err);
    }
  }

  return out;
}

/** Sensor Tower + Vertex-bound entry used by the API route. */
export async function discoverCompetitors(params: {
  focusAppId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  category: string | null;
  country: string;
  authToken: string;
}): Promise<DiscoveredCompetitor[]> {
  const [{ fetchAppStoreDetail, searchUnifiedApps }, { fetchCompetitorsForCategory }] = await Promise.all([
    import('../sensorTower/client'),
    import('../sensorTower/competitors'),
  ]);

  let detail: AppStoreDetail | null = null;
  try {
    if (params.iosAppId) {
      detail = await fetchAppStoreDetail('ios', params.iosAppId, params.authToken, params.country);
    } else if (params.androidAppId) {
      detail = await fetchAppStoreDetail('android', params.androidAppId, params.authToken, params.country);
    }
  } catch (err) {
    console.warn('Store detail fetch failed, discovery proceeds on name/category only:', err);
  }

  return discoverCompetitorsWithDeps({
    focusAppId: params.focusAppId,
    detail: {
      name: detail?.name || params.name,
      publisherName: detail?.publisherName || params.publisherName,
      subtitle: detail?.subtitle ?? null,
      description: detail?.description ?? null,
      categories: detail?.categories ?? [],
      lastMonthDownloads: detail?.lastMonthDownloads ?? null,
      lastMonthRevenue: detail?.lastMonthRevenue ?? null,
    },
    category: params.category,
    country: params.country,
    callGemini: async (prompt: string) => {
      const result = await getModel().generateContent(prompt);
      return result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    },
    searchApps: (term: string) => searchUnifiedApps(term, params.authToken, 5),
    fetchCategoryTop: (category: string, country: string) =>
      fetchCompetitorsForCategory({
        authToken: params.authToken,
        category,
        country,
        excludeAppId: params.focusAppId,
        limit: 25,
      }),
  });
}
