import { VertexAI } from '@google-cloud/vertexai';
import type { ScoredApp } from './scoringEngine';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
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
}

export async function generateGenreInsights(
  genreName: string,
  topApps: ScoredApp[],
  watchCandidates: ScoredApp[],
  periodData: Record<string, Record<string, { revenue: number; downloads: number }>>
): Promise<GenreInsight> {
  const model = getModel();

  const appSummaries = topApps.map((app, i) => {
    const periods = periodData[app.appId] || {};
    const periodLines = Object.entries(periods)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, d]) => `  ${p}: revenue=$${d.revenue.toLocaleString()}, downloads=${d.downloads.toLocaleString()}`)
      .join('\n');

    return `#${i + 1} ${app.appName} (by ${app.publisherName})
  Rising Star Score: ${app.score}/100
  Sub-scores: Revenue Accel=${app.subScores.revenueAcceleration}/25, Download Momentum=${app.subScores.downloadMomentum}/25, Anomaly=${app.subScores.anomalyScore}/25, Convergence=${app.subScores.crossMetricConvergence}/25
  Period data:
${periodLines}`;
  }).join('\n\n');

  const watchSummaries = watchCandidates.map(app =>
    `- ${app.appName} (score: ${app.score})`
  ).join('\n');

  const prompt = `You are a mobile gaming market analyst. Analyze the following top rising star games in the "${genreName}" genre.

TOP 5 RISING STARS:
${appSummaries}

WATCH LIST CANDIDATES (just outside top 5):
${watchSummaries}

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
  ]
}

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
  };
}
