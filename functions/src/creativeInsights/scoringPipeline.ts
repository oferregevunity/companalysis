import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';
import { creativeDocId } from '../adIntel/fetchCreativesForGenre';
import {
  computeLongevity,
  computeNetworkBreadth,
  computeImpressionMomentum,
  computeFreshnessAdjustedPersistence,
  computeWinningCreativeScore,
  type SubScores,
} from './scoringEngine';

export interface CreativeScoreRow {
  docId: string;
  creativeKey: string;
  appId: string;
  genreId: string;
  week: string;
  score: number;
  subScores: SubScores;
  /**
   * We store `computedAt` as an ISO string in the pure variant so tests
   * can be stable. The Firestore wrapper replaces this with
   * `FieldValue.serverTimestamp()` before writing.
   */
  computedAt: string;
}

export interface ScoreDeps {
  genreId: string;
  week: string;
  loadCreatives: (genreId: string, week: string) => Promise<StoredCreative[]>;
  writeScores: (rows: CreativeScoreRow[]) => Promise<void>;
  now?: Date;
}

export async function scoreCreativesForGenreWithDeps(deps: ScoreDeps): Promise<{ scored: number }> {
  const { genreId, week, loadCreatives, writeScores, now = new Date() } = deps;
  const creatives = await loadCreatives(genreId, week);

  const rows: CreativeScoreRow[] = creatives.map(c => {
    // KNOWN LIMITATION: Phase 2 has one week of data per creative, so
    // computeImpressionMomentum will always return 0 (requires ≥2 weekly
    // observations). Phase 7 follow-up: aggregate multi-week snapshots
    // before scoring. See docs/plans/2026-04-21-ad-creatives-competitor-analysis-plan.md Phase 7.
    const subScores: SubScores = {
      longevity: computeLongevity(c.durationDays),
      networkBreadth: computeNetworkBreadth(c.networks),
      impressionMomentum: computeImpressionMomentum({
        sovByWeek: c.maxShare != null ? { [week]: c.maxShare } : {},
        countriesByWeek: { [week]: 1 }, // single-country scrape
      }),
      freshnessAdjustedPersistence: computeFreshnessAdjustedPersistence(
        { firstSeen: c.firstSeen, durationDays: c.durationDays },
        now,
      ),
    };
    return {
      docId: creativeDocId(c.appId, c.creativeKey),
      creativeKey: c.creativeKey,
      appId: c.appId,
      genreId,
      week,
      score: computeWinningCreativeScore(subScores),
      subScores,
      computedAt: now.toISOString(),
    };
  });

  await writeScores(rows);
  return { scored: rows.length };
}

/**
 * Firestore-bound variant. Uses dynamic imports so tests that only import
 * `scoreCreativesForGenreWithDeps` don't pull in firebase-admin.
 *
 * Layout:
 *   creativeInsights/{genreId}_week_{week}                     (metadata)
 *     └─ scores/{docId}  (where docId = `${appId}__${creativeKey}`)
 */
export async function scoreCreativesForGenre(
  genreId: string,
  week: string,
): Promise<{ scored: number }> {
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const db = getFirestore('companalysis');
  const insightDocRef = db
    .collection('creativeInsights')
    .doc(`${genreId}_week_${week}`);

  return scoreCreativesForGenreWithDeps({
    genreId,
    week,
    loadCreatives: async () => {
      const snap = await db
        .collection('creativeSnapshots')
        .doc(`${genreId}_week_${week}`)
        .collection('creatives')
        .get();
      return snap.docs.map(d => d.data() as StoredCreative);
    },
    writeScores: async rows => {
      const BATCH = 400;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const batch = db.batch();
        for (const r of chunk) {
          const { computedAt, ...rest } = r;
          batch.set(insightDocRef.collection('scores').doc(r.docId), {
            ...rest,
            computedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
      await insightDocRef.set(
        {
          genreId,
          week,
          scoredAt: FieldValue.serverTimestamp(),
          scoredCount: rows.length,
        },
        { merge: true },
      );
    },
  });
}
