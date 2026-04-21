export interface GenreDoc {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface RunResult {
  success: boolean;
  creativeCount: number;
  scoredCount: number;
  insightsGenerated: boolean;
  partialErrors: string[];
}

export interface RunDeps {
  genre: GenreDoc;
  weekStart: string;
  weekEnd: string;
  authToken: string;
  fetchCreatives: (
    genre: GenreDoc,
    ws: string,
    we: string,
    t: string,
  ) => Promise<{ success: boolean; creativeCount: number; partialErrors: string[] }>;
  scoreCreatives: (genreId: string, week: string) => Promise<{ scored: number }>;
  generateInsights: (
    genreId: string,
    week: string,
    genreName: string,
  ) => Promise<{ ok: boolean; winners: number; geminiError?: string }>;
  weekKeyFromStart: (ws: string) => string;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runCreativePipelineForGenreWithDeps(deps: RunDeps): Promise<RunResult> {
  const {
    genre,
    weekStart,
    weekEnd,
    authToken,
    fetchCreatives,
    scoreCreatives,
    generateInsights,
    weekKeyFromStart,
  } = deps;

  const week = weekKeyFromStart(weekStart);
  const fetchResult = await fetchCreatives(genre, weekStart, weekEnd, authToken);

  const partialErrors = [...fetchResult.partialErrors];
  let scoredCount = 0;
  let scoreThrew = false;

  try {
    const scoreResult = await scoreCreatives(genre.id, week);
    scoredCount = scoreResult.scored;
  } catch (e) {
    scoreThrew = true;
    partialErrors.push(`score: ${errMessage(e)}`);
  }

  let insightsGenerated = true;
  try {
    const insightResult = await generateInsights(genre.id, week, genre.name);
    if (insightResult.geminiError) {
      insightsGenerated = false;
      partialErrors.push(`gemini: ${insightResult.geminiError}`);
    }
  } catch (e) {
    insightsGenerated = false;
    partialErrors.push(`gemini: ${errMessage(e)}`);
  }

  const success = fetchResult.success && insightsGenerated && !scoreThrew;

  return {
    success,
    creativeCount: fetchResult.creativeCount,
    scoredCount,
    insightsGenerated,
    partialErrors,
  };
}

export async function runCreativePipelineForGenre(
  genre: GenreDoc,
  weekStart: string,
  weekEnd: string,
  authToken: string,
): Promise<RunResult> {
  const [{ fetchCreativesForGenre, weekKeyFromStart }, { scoreCreativesForGenre }, { generateAndStoreCreativeInsights }] =
    await Promise.all([
      import('../adIntel/fetchCreativesForGenre'),
      import('./scoringPipeline'),
      import('./pipeline'),
    ]);

  return runCreativePipelineForGenreWithDeps({
    genre,
    weekStart,
    weekEnd,
    authToken,
    fetchCreatives: fetchCreativesForGenre as unknown as RunDeps['fetchCreatives'],
    scoreCreatives: scoreCreativesForGenre,
    generateInsights: generateAndStoreCreativeInsights,
    weekKeyFromStart,
  });
}
