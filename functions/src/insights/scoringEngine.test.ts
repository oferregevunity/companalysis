import { describe, it, expect } from 'vitest';
import {
  computeRevenueAcceleration,
  computeDownloadMomentum,
  computeAnomalyScore,
  computeConvergence,
  computeRisingStarScore,
  selectTopRisingStars,
  type AppScoreInput,
  type ScoredApp,
  type SubScores,
} from './scoringEngine';

// ---------------------------------------------------------------------------
// computeRevenueAcceleration
// ---------------------------------------------------------------------------
describe('computeRevenueAcceleration', () => {
  it('returns 0 for empty data', () => {
    expect(computeRevenueAcceleration({})).toBe(0);
  });

  it('returns 0 for single-period data', () => {
    expect(computeRevenueAcceleration({ '2024-01': 1000 })).toBe(0);
  });

  it('returns high score (>18) for strongly accelerating growth (+50% → +100% → +150%)', () => {
    // Each period grows by an accelerating percentage
    // base=1000, +50%=1500, +100%=3000, +150%=7500
    const data = {
      '2024-01': 1000,
      '2024-02': 1500,
      '2024-03': 3000,
      '2024-04': 7500,
    };
    const score = computeRevenueAcceleration(data);
    expect(score).toBeGreaterThan(18);
  });

  it('returns a positive but low score for steady +20% growth (no acceleration bonus)', () => {
    // The algorithm gives baseScore = weightedAvg/10, capped at 15.
    // For steady 20% MoM growth: weightedAvg = 20, baseScore = 2, no acceleration bonus.
    const data = {
      '2024-01': 1000,
      '2024-02': 1200,
      '2024-03': 1440,
      '2024-04': 1728,
    };
    const score = computeRevenueAcceleration(data);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(5);
  });

  it('returns 0 for declining revenue', () => {
    const data = {
      '2024-01': 1000,
      '2024-02': 900,
      '2024-03': 800,
      '2024-04': 700,
    };
    expect(computeRevenueAcceleration(data)).toBe(0);
  });

  it('returns low score (<10) for decelerating growth', () => {
    // Positive but slowing: +30%, +20%, +10%
    const data = {
      '2024-01': 1000,
      '2024-02': 1300,
      '2024-03': 1560,
      '2024-04': 1716,
    };
    const score = computeRevenueAcceleration(data);
    expect(score).toBeLessThan(10);
  });

  it('returns score capped at 25', () => {
    // Extremely explosive growth
    const data = {
      '2024-01': 100,
      '2024-02': 1000,
      '2024-03': 10000,
      '2024-04': 100000,
    };
    const score = computeRevenueAcceleration(data);
    expect(score).toBeLessThanOrEqual(25);
  });

  it('handles zero previous value by treating change as +100%', () => {
    const data = {
      '2024-01': 0,
      '2024-02': 1000,
    };
    const score = computeRevenueAcceleration(data);
    expect(score).toBeGreaterThan(0);
  });

  it('returns a number within 0-25 range', () => {
    const data = {
      '2024-01': 500,
      '2024-02': 600,
      '2024-03': 750,
    };
    const score = computeRevenueAcceleration(data);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// computeDownloadMomentum
// ---------------------------------------------------------------------------
describe('computeDownloadMomentum', () => {
  it('returns 0 for empty data', () => {
    expect(computeDownloadMomentum({})).toBe(0);
  });

  it('returns 0 for single-period data', () => {
    expect(computeDownloadMomentum({ '2024-01': 5000 })).toBe(0);
  });

  it('returns high score for strong download growth with acceleration', () => {
    // +50% → +100% → +150% download growth
    const data = {
      '2024-01': 10000,
      '2024-02': 15000,
      '2024-03': 30000,
      '2024-04': 75000,
    };
    const score = computeDownloadMomentum(data);
    expect(score).toBeGreaterThan(18);
  });

  it('returns 0 for declining downloads', () => {
    const data = {
      '2024-01': 10000,
      '2024-02': 9000,
      '2024-03': 8000,
    };
    expect(computeDownloadMomentum(data)).toBe(0);
  });

  it('returns a number within 0-25 range', () => {
    const data = {
      '2024-01': 1000,
      '2024-02': 1200,
      '2024-03': 1440,
    };
    const score = computeDownloadMomentum(data);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(25);
  });

  it('produces the same result as computeRevenueAcceleration for identical data', () => {
    const data = {
      '2024-01': 1000,
      '2024-02': 1500,
      '2024-03': 3000,
    };
    expect(computeDownloadMomentum(data)).toBe(computeRevenueAcceleration(data));
  });
});

// ---------------------------------------------------------------------------
// computeAnomalyScore
// ---------------------------------------------------------------------------
describe('computeAnomalyScore', () => {
  const empty: Record<string, number> = {};

  it('returns 0 for empty revenue and download data', () => {
    expect(computeAnomalyScore(empty, empty)).toBe(0);
  });

  it('returns 0 when only one period of data exists', () => {
    const single = { '2024-01': 1000 };
    expect(computeAnomalyScore(single, single)).toBe(0);
  });

  it('returns 0 when fewer than 3 periods of data exist', () => {
    const two = { '2024-01': 1000, '2024-02': 1100 };
    expect(computeAnomalyScore(two, two)).toBe(0);
  });

  it('returns high score (>18) for sudden 5x revenue spike after flat history', () => {
    // Flat history of ~1000, then spikes to 5000
    const revData = {
      '2024-01': 1000,
      '2024-02': 1000,
      '2024-03': 1000,
      '2024-04': 1000,
      '2024-05': 5000,
    };
    const dlData = {
      '2024-01': 1000,
      '2024-02': 1000,
      '2024-03': 1000,
      '2024-04': 1000,
      '2024-05': 1000,
    };
    const score = computeAnomalyScore(revData, dlData);
    expect(score).toBeGreaterThan(18);
  });

  it('returns high score (>18) for sudden 5x download spike after flat history', () => {
    const revData = {
      '2024-01': 1000,
      '2024-02': 1000,
      '2024-03': 1000,
      '2024-04': 1000,
      '2024-05': 1000,
    };
    const dlData = {
      '2024-01': 1000,
      '2024-02': 1000,
      '2024-03': 1000,
      '2024-04': 1000,
      '2024-05': 5000,
    };
    const score = computeAnomalyScore(revData, dlData);
    expect(score).toBeGreaterThan(18);
  });

  it('returns low score (<5) for steady, unchanging values', () => {
    const steady = {
      '2024-01': 1000,
      '2024-02': 1000,
      '2024-03': 1000,
      '2024-04': 1000,
    };
    const score = computeAnomalyScore(steady, steady);
    expect(score).toBeLessThan(5);
  });

  it('returns a number within 0-25 range', () => {
    const data = {
      '2024-01': 1000,
      '2024-02': 1100,
      '2024-03': 1200,
      '2024-04': 1300,
    };
    const score = computeAnomalyScore(data, data);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// computeConvergence
// ---------------------------------------------------------------------------
describe('computeConvergence', () => {
  it('returns 0 for empty revenue data', () => {
    expect(computeConvergence({}, {})).toBe(0);
  });

  it('returns 0 for empty download data', () => {
    expect(computeConvergence({ '2024-01': 1000, '2024-02': 1200 }, {})).toBe(0);
  });

  it('returns high score (>18) when both revenue and downloads rise together strongly', () => {
    // Both growing at 100%+ per period
    const revData = {
      '2024-01': 1000,
      '2024-02': 2000,
      '2024-03': 4000,
      '2024-04': 8000,
    };
    const dlData = {
      '2024-01': 10000,
      '2024-02': 20000,
      '2024-03': 40000,
      '2024-04': 80000,
    };
    const score = computeConvergence(revData, dlData);
    expect(score).toBeGreaterThan(18);
  });

  it('returns low score (<10) when only revenue rises (downloads flat)', () => {
    const revData = {
      '2024-01': 1000,
      '2024-02': 2000,
      '2024-03': 4000,
    };
    const dlData = {
      '2024-01': 10000,
      '2024-02': 10000,
      '2024-03': 10000,
    };
    const score = computeConvergence(revData, dlData);
    expect(score).toBeLessThan(10);
  });

  it('returns 0 when both revenue and downloads decline', () => {
    const revData = {
      '2024-01': 1000,
      '2024-02': 900,
      '2024-03': 800,
    };
    const dlData = {
      '2024-01': 10000,
      '2024-02': 9000,
      '2024-03': 8000,
    };
    expect(computeConvergence(revData, dlData)).toBe(0);
  });

  it('returns a small positive score when one metric rises and the other declines', () => {
    const revData = {
      '2024-01': 1000,
      '2024-02': 1500,
      '2024-03': 2000,
    };
    const dlData = {
      '2024-01': 10000,
      '2024-02': 9000,
      '2024-03': 8000,
    };
    const score = computeConvergence(revData, dlData);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(10);
  });

  it('returns a number within 0-25 range', () => {
    const revData = {
      '2024-01': 1000,
      '2024-02': 1200,
      '2024-03': 1440,
    };
    const dlData = {
      '2024-01': 5000,
      '2024-02': 6000,
      '2024-03': 7200,
    };
    const score = computeConvergence(revData, dlData);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// computeRisingStarScore
// ---------------------------------------------------------------------------
describe('computeRisingStarScore', () => {
  const baseInput: AppScoreInput = {
    appId: 'app-123',
    appName: 'Test Game',
    publisherName: 'Test Publisher',
    revenueByPeriod: {
      '2024-01': 1000,
      '2024-02': 1500,
      '2024-03': 3000,
      '2024-04': 7500,
    },
    downloadsByPeriod: {
      '2024-01': 10000,
      '2024-02': 15000,
      '2024-03': 30000,
      '2024-04': 75000,
    },
  };

  it('returns a ScoredApp with appId, appName, publisherName', () => {
    const result = computeRisingStarScore(baseInput);
    expect(result.appId).toBe('app-123');
    expect(result.appName).toBe('Test Game');
    expect(result.publisherName).toBe('Test Publisher');
  });

  it('returns composite score in 0-100 range', () => {
    const result = computeRisingStarScore(baseInput);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('all sub-scores are within 0-25 range', () => {
    const result = computeRisingStarScore(baseInput);
    expect(result.subScores.revenueAcceleration).toBeGreaterThanOrEqual(0);
    expect(result.subScores.revenueAcceleration).toBeLessThanOrEqual(25);
    expect(result.subScores.downloadMomentum).toBeGreaterThanOrEqual(0);
    expect(result.subScores.downloadMomentum).toBeLessThanOrEqual(25);
    expect(result.subScores.anomalyScore).toBeGreaterThanOrEqual(0);
    expect(result.subScores.anomalyScore).toBeLessThanOrEqual(25);
    expect(result.subScores.crossMetricConvergence).toBeGreaterThanOrEqual(0);
    expect(result.subScores.crossMetricConvergence).toBeLessThanOrEqual(25);
  });

  it('composite score equals sum of sub-scores (rounded to 1 decimal)', () => {
    const result = computeRisingStarScore(baseInput);
    const expectedSum = Math.round(
      (result.subScores.revenueAcceleration +
        result.subScores.downloadMomentum +
        result.subScores.anomalyScore +
        result.subScores.crossMetricConvergence) *
        10
    ) / 10;
    expect(result.score).toBe(expectedSum);
  });

  it('returns score 0 for app with no data', () => {
    const emptyApp: AppScoreInput = {
      appId: 'empty',
      appName: 'Empty',
      publisherName: 'Nobody',
      revenueByPeriod: {},
      downloadsByPeriod: {},
    };
    const result = computeRisingStarScore(emptyApp);
    expect(result.score).toBe(0);
  });

  it('returns high composite score for strongly growing app', () => {
    const result = computeRisingStarScore(baseInput);
    // With accelerating growth in both metrics, should score well
    expect(result.score).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// selectTopRisingStars
// ---------------------------------------------------------------------------
describe('selectTopRisingStars', () => {
  const makeApp = (id: string, revenueMultiplier: number): AppScoreInput => ({
    appId: id,
    appName: `App ${id}`,
    publisherName: 'Publisher',
    revenueByPeriod: {
      '2024-01': 1000 * revenueMultiplier,
      '2024-02': 1500 * revenueMultiplier,
      '2024-03': 3000 * revenueMultiplier,
    },
    downloadsByPeriod: {
      '2024-01': 5000 * revenueMultiplier,
      '2024-02': 7500 * revenueMultiplier,
      '2024-03': 15000 * revenueMultiplier,
    },
  });

  const apps: AppScoreInput[] = [
    // Strongly and accelerating growing app: +100%, +200%, +300%
    {
      appId: 'top',
      appName: 'Top App',
      publisherName: 'Publisher',
      revenueByPeriod: { '2024-01': 1000, '2024-02': 2000, '2024-03': 6000, '2024-04': 24000 },
      downloadsByPeriod: { '2024-01': 5000, '2024-02': 10000, '2024-03': 30000, '2024-04': 120000 },
    },
    // Declining app
    {
      appId: 'declining',
      appName: 'Declining App',
      publisherName: 'Publisher',
      revenueByPeriod: { '2024-01': 5000, '2024-02': 4000, '2024-03': 3000 },
      downloadsByPeriod: { '2024-01': 20000, '2024-02': 16000, '2024-03': 12000 },
    },
    makeApp('mid1', 1),
    makeApp('mid2', 2),
    makeApp('mid3', 3),
    makeApp('mid4', 4),
    makeApp('mid5', 5),
  ];

  it('returns top N apps sorted descending by score', () => {
    const result = selectTopRisingStars(apps, 5);
    expect(result).toHaveLength(5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('uses default topN of 5 when not specified', () => {
    const result = selectTopRisingStars(apps);
    expect(result).toHaveLength(5);
  });

  it('returns fewer items if there are fewer apps than topN', () => {
    const twoApps = apps.slice(0, 2);
    const result = selectTopRisingStars(twoApps, 5);
    expect(result).toHaveLength(2);
  });

  it('places the top growing app first', () => {
    const result = selectTopRisingStars(apps, 3);
    expect(result[0].appId).toBe('top');
  });

  it('does not include the declining app in top 5 when stronger competitors exist', () => {
    const result = selectTopRisingStars(apps, 5);
    const ids = result.map(a => a.appId);
    // With 7 apps and top 5 selected, declining app should not appear
    expect(ids).not.toContain('declining');
  });

  it('returns ScoredApp objects with all required fields', () => {
    const result = selectTopRisingStars(apps, 1);
    expect(result[0]).toHaveProperty('appId');
    expect(result[0]).toHaveProperty('appName');
    expect(result[0]).toHaveProperty('publisherName');
    expect(result[0]).toHaveProperty('score');
    expect(result[0]).toHaveProperty('subScores');
    expect(result[0].subScores).toHaveProperty('revenueAcceleration');
    expect(result[0].subScores).toHaveProperty('downloadMomentum');
    expect(result[0].subScores).toHaveProperty('anomalyScore');
    expect(result[0].subScores).toHaveProperty('crossMetricConvergence');
  });

  it('handles empty input array', () => {
    const result = selectTopRisingStars([], 5);
    expect(result).toHaveLength(0);
  });
});
