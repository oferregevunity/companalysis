import { VertexAI } from '@google-cloud/vertexai';
import type { ScoredApp } from './scoringEngine';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

export interface GameIdea {
  title: string;
  hook: string;
  coreLoop: string;
  monetization: string;
  inspiredBy: string[];
}

export interface GenreInsight {
  summary: string;
  games: Array<{
    appId: string;
    appName: string;
    publisherName: string;
    rank: number;
    score: number;
    subScores: ScoredApp['subScores'];
    explanation: string;
  }>;
  watchList: Array<{
    appId: string;
    appName: string;
    publisherName: string;
    score: number;
    reason: string;
  }>;
  correlations?: {
    themes: string[];
    mechanics: string[];
    analysis: string;
  };
  newGameIdeas?: GameIdea[];
}

export async function generateGenreInsights(
  genreName: string,
  topApps: ScoredApp[],
  watchCandidates: ScoredApp[],
  periodData: Record<string, Record<string, { revenue: number; downloads: number }>>,
  appDescriptions?: Map<string, { description: string; genre?: string }>
): Promise<GenreInsight> {
  const model = getModel();

  const appSummaries = topApps.map((app, i) => {
    const periods = periodData[app.appId] || {};
    const periodLines = Object.entries(periods)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, d]) => `  ${p}: revenue=$${d.revenue.toLocaleString()}, downloads=${d.downloads.toLocaleString()}`)
      .join('\n');

    const desc = appDescriptions?.get(app.appId);
    const descLine = desc ? `\n  Genre: ${desc.genre || 'N/A'}\n  Description: ${desc.description}` : '';

    return `#${i + 1} ${app.appName} (by ${app.publisherName})
  Rising Star Score: ${app.score}/100
  Sub-scores: Revenue Accel=${app.subScores.revenueAcceleration}/25, Download Momentum=${app.subScores.downloadMomentum}/25, Anomaly=${app.subScores.anomalyScore}/25, Convergence=${app.subScores.crossMetricConvergence}/25${descLine}
  Period data:
${periodLines}`;
  }).join('\n\n');

  const watchSummaries = watchCandidates.map(app => {
    const desc = appDescriptions?.get(app.appId);
    const descPart = desc ? ` — ${desc.genre || ''} ${desc.description.slice(0, 100)}...` : '';
    return `- ${app.appName} (score: ${app.score})${descPart}`;
  }).join('\n');

  const hasDescriptions = appDescriptions && appDescriptions.size > 0;
  const correlationInstruction = hasDescriptions
    ? `\n\nIMPORTANT: Also analyze correlations between the rising games. Look at their descriptions, gameplay mechanics, themes, and art styles. Identify:
- Common gameplay themes (e.g., "merge mechanics", "idle progression", "match-3 puzzle")
- Shared game mechanics or monetization patterns
- What these correlations suggest about current player demand in this genre

Add a "correlations" section to your JSON response.`
    : `\n\nAlso analyze correlations between the rising games based on their names, publishers, and growth patterns. Identify any common themes or patterns you can infer.

Add a "correlations" section to your JSON response.`;

  const prompt = `You are a mobile gaming market analyst. Analyze the following top rising star games in the "${genreName}" genre.

TOP 5 RISING STARS:
${appSummaries}

WATCH LIST CANDIDATES (just outside top 5):
${watchSummaries}
${correlationInstruction}

Respond in valid JSON with this exact structure (no markdown, no code fences):
{
  "summary": "2-3 sentence genre trend summary",
  "games": [
    {
      "rank": 1,
      "appId": "the-app-id",
      "explanation": "2-3 sentences explaining why this game is rising"
    }
  ],
  "watchList": [
    {
      "appId": "the-app-id",
      "reason": "1 sentence why this game is worth watching"
    }
  ],
  "correlations": {
    "themes": ["theme1", "theme2"],
    "mechanics": ["mechanic1", "mechanic2"],
    "analysis": "2-4 sentence analysis of what patterns suggest about player demand and genre trends"
  },
  "newGameIdeas": [
    {
      "title": "short catchy working title",
      "hook": "1 sentence pitch — what makes it compelling",
      "coreLoop": "1-2 sentences describing the core gameplay loop",
      "monetization": "1 sentence on the primary monetization angle (e.g. rewarded ads, IAP progression packs, battle pass)",
      "inspiredBy": ["names of the rising games above whose repeated concepts inspired this"]
    }
  ]
}

For "newGameIdeas": look at the concepts, mechanics, and themes that REPEAT across the rising games in this genre, and ideate 2-3 concrete NEW game concepts that a studio could build to capture that same demand. Each idea must be grounded in the repeated patterns you observed — cite the specific games in "inspiredBy". Do not simply clone one game; synthesize the shared winning ingredients.

For each game explanation, reference specific data points (% changes, revenue figures, download trends). Be concise and analytical. Focus on what the numbers suggest about the game's trajectory.`;

  const result = await model.generateContent(prompt);
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    summary: parsed.summary || '',
    games: topApps.map((app, i) => {
      const geminiGame = parsed.games?.find(
        (g: { appId?: string; rank?: number }) => g.appId === app.appId || g.rank === i + 1
      );
      return {
        appId: app.appId,
        appName: app.appName,
        publisherName: app.publisherName,
        rank: i + 1,
        score: app.score,
        subScores: app.subScores,
        explanation: geminiGame?.explanation || 'No analysis available.',
      };
    }),
    watchList: watchCandidates.slice(0, 2).map(app => {
      const geminiWatch = parsed.watchList?.find(
        (w: { appId?: string }) => w.appId === app.appId
      );
      return {
        appId: app.appId,
        appName: app.appName,
        publisherName: app.publisherName,
        score: app.score,
        reason: geminiWatch?.reason || 'Score approaching top 5 threshold.',
      };
    }),
    correlations: parsed.correlations ? {
      themes: parsed.correlations.themes || [],
      mechanics: parsed.correlations.mechanics || [],
      analysis: parsed.correlations.analysis || '',
    } : undefined,
    newGameIdeas: parseGameIdeas(parsed.newGameIdeas),
  };
}

function parseGameIdeas(raw: unknown): GameIdea[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((idea): GameIdea | null => {
      if (!idea || typeof idea !== 'object') return null;
      const o = idea as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      if (!title) return null;
      return {
        title,
        hook: typeof o.hook === 'string' ? o.hook : '',
        coreLoop: typeof o.coreLoop === 'string' ? o.coreLoop : '',
        monetization: typeof o.monetization === 'string' ? o.monetization : '',
        inspiredBy: Array.isArray(o.inspiredBy)
          ? o.inspiredBy.filter((x): x is string => typeof x === 'string')
          : [],
      };
    })
    .filter((x): x is GameIdea => x !== null)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Cross-genre analysis: concepts that recur ACROSS different genres, and new
// game ideas that combine those cross-genre patterns.
// ---------------------------------------------------------------------------

export interface CrossGenreInput {
  genreName: string;
  themes: string[];
  mechanics: string[];
  topGames: string[];
}

export interface CrossGenreInsight {
  repeatedConcepts: Array<{ concept: string; genres: string[] }>;
  analysis: string;
  newGameIdeas: GameIdea[];
}

export async function generateCrossGenreIdeas(
  genres: CrossGenreInput[]
): Promise<CrossGenreInsight> {
  const model = getModel();

  const genreBlocks = genres
    .map(g => {
      const themes = g.themes.length ? g.themes.join(', ') : '(none identified)';
      const mechanics = g.mechanics.length ? g.mechanics.join(', ') : '(none identified)';
      const games = g.topGames.length ? g.topGames.join(', ') : '(none)';
      return `GENRE: ${g.genreName}
  Recurring themes: ${themes}
  Recurring mechanics: ${mechanics}
  Top rising games: ${games}`;
    })
    .join('\n\n');

  const prompt = `You are a mobile gaming market analyst looking across MULTIPLE genres at once.

Below is a per-genre breakdown of the concepts, mechanics, themes, and top rising games for each genre:

${genreBlocks}

Identify concepts, mechanics, or themes that RECUR ACROSS DIFFERENT genres (not just within one). These cross-genre patterns are the strongest signal of broad player demand. Then ideate 2-3 concrete NEW game concepts that a studio could build by COMBINING these cross-genre patterns.

Respond in valid JSON with this exact structure (no markdown, no code fences):
{
  "repeatedConcepts": [
    { "concept": "the recurring concept/mechanic/theme", "genres": ["Genre A", "Genre B"] }
  ],
  "analysis": "2-4 sentences on what the cross-genre overlap reveals about broad player demand and where the opportunity is",
  "newGameIdeas": [
    {
      "title": "short catchy working title",
      "hook": "1 sentence pitch",
      "coreLoop": "1-2 sentences on the core gameplay loop",
      "monetization": "1 sentence on the primary monetization angle",
      "inspiredBy": ["names of genres and/or specific games that inspired this"]
    }
  ]
}

Only list a concept under "repeatedConcepts" if it appears in TWO OR MORE distinct genres. Each new game idea must synthesize patterns from at least two genres — cite them in "inspiredBy". Ideate 2-3 games.`;

  const result = await model.generateContent(prompt);
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const repeatedConcepts = Array.isArray(parsed.repeatedConcepts)
    ? parsed.repeatedConcepts
        .map((c: unknown) => {
          if (!c || typeof c !== 'object') return null;
          const o = c as Record<string, unknown>;
          const concept = typeof o.concept === 'string' ? o.concept.trim() : '';
          if (!concept) return null;
          return {
            concept,
            genres: Array.isArray(o.genres)
              ? o.genres.filter((x: unknown): x is string => typeof x === 'string')
              : [],
          };
        })
        .filter((x: unknown): x is { concept: string; genres: string[] } => x !== null)
    : [];

  return {
    repeatedConcepts,
    analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
    newGameIdeas: parseGameIdeas(parsed.newGameIdeas),
  };
}
