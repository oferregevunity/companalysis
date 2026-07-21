import { describe, it, expect } from 'vitest';
import { aggregateWeek, computeRising, type GenreWeekTags } from './aggregate';

function tag(creativeId: string, hookType: string, themes: string[] = []) {
  return { creativeId, hookType, themes };
}

describe('aggregateWeek', () => {
  it('counts hooks/themes and tracks examples + genre coverage', () => {
    const genres: GenreWeekTags[] = [
      { genreId: 'puzzle', tags: [tag('a__1', 'Challenge / Can You Beat', ['boss fight']), tag('a__2', 'Challenge / Can You Beat', ['Jackpot'])] },
      { genreId: 'casino', tags: [tag('b__1', 'Challenge / Can You Beat', ['jackpot'])] },
    ];
    const agg = aggregateWeek(genres);
    expect(agg.totalTags).toBe(3);
    expect(agg.hookCounts.get('Challenge / Can You Beat')).toBe(3);
    // Theme casing is normalized.
    expect(agg.themeCounts.get('jackpot')).toBe(2);
    expect([...agg.hookGenres.get('Challenge / Can You Beat')!].sort()).toEqual(['casino', 'puzzle']);
    expect(agg.hookExamples.get('Challenge / Can You Beat')).toContain('a__1');
  });
});

describe('computeRising', () => {
  it('flags a brand-new concept and a growing one, skips shrinking ones', () => {
    const thisWeek = aggregateWeek([
      { genreId: 'g1', tags: [tag('n__1', 'Comparison / VS'), tag('n__2', 'Comparison / VS'), tag('n__3', 'Comparison / VS')] }, // new
      { genreId: 'g1', tags: [tag('u__1', 'Fail & Frustration'), tag('u__2', 'Fail & Frustration'), tag('u__3', 'Fail & Frustration'), tag('u__4', 'Fail & Frustration')] }, // grew 2→4
      { genreId: 'g1', tags: [tag('d__1', 'Satisfying / ASMR'), tag('d__2', 'Satisfying / ASMR'), tag('d__3', 'Satisfying / ASMR')] }, // shrank 6→3
    ]);
    const prevWeek = aggregateWeek([
      { genreId: 'g1', tags: [tag('p1', 'Fail & Frustration'), tag('p2', 'Fail & Frustration')] },
      {
        genreId: 'g1',
        tags: [tag('q1', 'Satisfying / ASMR'), tag('q2', 'Satisfying / ASMR'), tag('q3', 'Satisfying / ASMR'), tag('q4', 'Satisfying / ASMR'), tag('q5', 'Satisfying / ASMR'), tag('q6', 'Satisfying / ASMR')],
      },
    ]);

    const { clusters } = computeRising(thisWeek, prevWeek, { minHookCount: 3, minThemeCount: 99 });
    const labels = clusters.map((c) => c.label);
    // "Comparison / VS" is new (prev 0) → first.
    expect(clusters[0].label).toBe('Comparison / VS');
    expect(clusters[0].isNew).toBe(true);
    expect(clusters[0].wowGrowthPct).toBeNull();
    // Growing hook present with +100% growth.
    const grew = clusters.find((c) => c.label === 'Fail & Frustration');
    expect(grew?.wowGrowthPct).toBe(100);
    // Shrinking hook excluded.
    expect(labels).not.toContain('Satisfying / ASMR');
  });

  it('null WoW deltas on top hooks when there is no prior week', () => {
    const thisWeek = aggregateWeek([{ genreId: 'g', tags: [tag('a', 'Reward / Progression'), tag('b', 'Reward / Progression'), tag('c', 'Reward / Progression')] }]);
    const empty = aggregateWeek([]);
    const { topHooks } = computeRising(thisWeek, empty);
    expect(topHooks[0].hookType).toBe('Reward / Progression');
    expect(topHooks[0].wowDelta).toBeNull();
  });
});
