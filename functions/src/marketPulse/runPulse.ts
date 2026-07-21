import { aggregateWeek, computeRising, type GenreWeekTags, type HookShare, type ThemeShare } from './aggregate';
import type { NamedRisingConcept } from './geminiClient';

export interface MarketPulseDoc {
  week: string;
  generatedAt?: { seconds: number; nanoseconds: number };
  genresScanned: string[];
  risingConcepts: NamedRisingConcept[];
  topHooks: HookShare[];
  topThemes: ThemeShare[];
  /** Set on the first-ever run (no prior week) — WoW growth is not yet meaningful. */
  note?: string;
  geminiError?: string;
}

export interface RunPulseDeps {
  week: string;
  prevWeek: string;
  genreIds: string[];
  /** Load the hook/theme tags for every scanned genre in a given week. */
  loadTags: (week: string) => Promise<GenreWeekTags[]>;
  /** Name the rising clusters (Gemini). */
  nameConcepts: (clusters: import('./aggregate').RisingCluster[], week: string) => Promise<{
    concepts: NamedRisingConcept[];
    geminiError?: string;
  }>;
}

/** Pure orchestration: aggregate this vs prior week, rank rising clusters, name them. */
export async function runMarketPulseWithDeps(deps: RunPulseDeps): Promise<MarketPulseDoc> {
  const { week, prevWeek, genreIds, loadTags, nameConcepts } = deps;

  const thisTags = await loadTags(week);
  const prevTags = await loadTags(prevWeek);

  const thisAgg = aggregateWeek(thisTags);
  const prevAgg = aggregateWeek(prevTags);
  const { clusters, topHooks, topThemes } = computeRising(thisAgg, prevAgg);

  const { concepts, geminiError } = await nameConcepts(clusters, week);

  const hasPrev = prevAgg.totalTags > 0;
  return {
    week,
    genresScanned: genreIds,
    risingConcepts: concepts,
    topHooks,
    topThemes,
    ...(hasPrev ? {} : { note: 'Baseline week — week-over-week growth needs a second scan.' }),
    ...(geminiError ? { geminiError } : {}),
  };
}

/** ISO week key for the week 7 days before `weekStart`. */
function previousWeekKey(weekStart: string, weekKeyFromStart: (s: string) => string): string {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() - 7);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return weekKeyFromStart(`${y}-${m}-${day}`);
}

/**
 * Firestore-bound entry. Ensures each opted-in genre is fetched + hook/theme
 * tagged for the target week (reusing the genre creative pipeline), then reads
 * the resulting `creativeInsights` tags and writes `marketPulse/{week}`.
 *
 * Genres opt in via `marketPulse === true` on their `genres` doc; falls back to
 * `enableCreatives === true` when none are flagged.
 */
export async function runMarketPulse(params: {
  authToken: string;
  weekStart: string;
  weekEnd: string;
  /** Skip the (expensive) fetch/tag step and only aggregate existing insight docs. */
  skipFetch?: boolean;
  /** Stop starting new genre fetches after this epoch-ms deadline. */
  deadlineMs?: number;
}): Promise<{ ok: boolean; week: string; genresScanned: number; risingConcepts: number; errors: string[] }> {
  const [{ getFirestore, FieldValue }, { weekKeyFromStart }, { runCreativePipelineForGenre }, { nameRisingConcepts }] =
    await Promise.all([
      import('firebase-admin/firestore'),
      import('../adIntel/fetchCreativesForGenre'),
      import('../creativeInsights/runForGenre'),
      import('./geminiClient'),
    ]);

  const db = getFirestore('companalysis');
  const week = weekKeyFromStart(params.weekStart);
  const prevWeek = previousWeekKey(params.weekStart, weekKeyFromStart);
  const errors: string[] = [];

  // Resolve the opted-in genre set.
  let snap = await db.collection('genres').where('marketPulse', '==', true).get();
  if (snap.empty) snap = await db.collection('genres').where('enableCreatives', '==', true).get();
  const genres = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  const genreIds = genres.map((g) => g.id);

  const now = () => Date.now();
  if (!params.skipFetch) {
    for (const genre of genres) {
      if (params.deadlineMs && now() > params.deadlineMs) {
        errors.push(`market-pulse: time budget exhausted before ${genre.id}`);
        break;
      }
      try {
        // Skip genres already tagged for this week to avoid needless Sensor Tower calls.
        const insight = await db.collection('creativeInsights').doc(`${genre.id}_week_${week}`).get();
        const tags = insight.exists ? (insight.data() as { creativeTags?: unknown[] }).creativeTags : undefined;
        if (Array.isArray(tags) && tags.length > 0) continue;
        await runCreativePipelineForGenre(genre as never, params.weekStart, params.weekEnd, params.authToken);
      } catch (err) {
        errors.push(`market-pulse fetch ${genre.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const loadTags = async (wk: string): Promise<GenreWeekTags[]> => {
    const out: GenreWeekTags[] = [];
    for (const id of genreIds) {
      const doc = await db.collection('creativeInsights').doc(`${id}_week_${wk}`).get();
      if (!doc.exists) continue;
      const data = doc.data() as { creativeTags?: Array<{ creativeId?: unknown; hookType?: unknown; themes?: unknown }> };
      const tags = Array.isArray(data.creativeTags) ? data.creativeTags : [];
      out.push({
        genreId: id,
        tags: tags
          .filter((t) => t && typeof t.creativeId === 'string')
          .map((t) => ({
            creativeId: String(t.creativeId),
            hookType: String(t.hookType ?? 'Other'),
            themes: Array.isArray(t.themes) ? t.themes.map(String) : [],
          })),
      });
    }
    return out;
  };

  const doc = await runMarketPulseWithDeps({
    week,
    prevWeek,
    genreIds,
    loadTags,
    nameConcepts: (clusters, wk) => nameRisingConcepts(clusters, wk),
  });

  const { generatedAt: _drop, ...rest } = doc;
  await db.collection('marketPulse').doc(week).set(
    { ...rest, generatedAt: FieldValue.serverTimestamp(), errors },
    { merge: true },
  );

  return {
    ok: true,
    week,
    genresScanned: genreIds.length,
    risingConcepts: doc.risingConcepts.length,
    errors,
  };
}
