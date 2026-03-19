// ---------------------------------------------------------------------------
// Rising Star Scoring Engine
//
// Computes a composite 0-100 score per app from 4 sub-scores (each 0-25):
//   1. Revenue Acceleration
//   2. Download Momentum
//   3. Anomaly Score
//   4. Cross-Metric Convergence
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppScoreInput {
  appId: string;
  appName: string;
  publisherName: string;
  revenueByPeriod: Record<string, number>;
  downloadsByPeriod: Record<string, number>;
}

export interface SubScores {
  revenueAcceleration: number;
  downloadMomentum: number;
  anomalyScore: number;
  crossMetricConvergence: number;
}

export interface ScoredApp {
  appId: string;
  appName: string;
  publisherName: string;
  score: number;
  subScores: SubScores;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute percent changes between consecutive sorted periods.
 * Keys must be lexicographically sortable (e.g., "2025-01", "2025-W03").
 * When prev is 0 and curr > 0, returns +100% (capped).
 */
function percentChanges(
  valuesByPeriod: Record<string, number>
): { period: string; pctChange: number }[] {
  const sorted = Object.keys(valuesByPeriod).sort();
  const changes: { period: string; pctChange: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = valuesByPeriod[sorted[i - 1]];
    const curr = valuesByPeriod[sorted[i]];
    if (prev > 0) {
      changes.push({ period: sorted[i], pctChange: ((curr - prev) / prev) * 100 });
    } else if (curr > 0) {
      changes.push({ period: sorted[i], pctChange: 100 });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Sub-Score 1: Revenue Acceleration (0-25)
// ---------------------------------------------------------------------------

export function computeRevenueAcceleration(revenueByPeriod: Record<string, number>): number {
  const changes = percentChanges(revenueByPeriod);
  if (changes.length === 0) return 0;

  const weights = changes.map((_, i) => i + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedAvg =
    changes.reduce((sum, c, i) => sum + c.pctChange * weights[i], 0) / totalWeight;

  if (weightedAvg <= 0) return 0;

  let accelerationBonus = 0;
  if (changes.length >= 2) {
    let accelerating = 0;
    for (let i = 1; i < changes.length; i++) {
      if (changes[i].pctChange > changes[i - 1].pctChange) accelerating++;
    }
    accelerationBonus = (accelerating / (changes.length - 1)) * 10;
  }

  const baseScore = Math.min(weightedAvg / 10, 15);
  const raw = baseScore + accelerationBonus;
  return Math.min(Math.round(raw * 10) / 10, 25);
}

// ---------------------------------------------------------------------------
// Sub-Score 2: Download Momentum (0-25)
// ---------------------------------------------------------------------------

// Same algorithm as revenue acceleration. Separate function so it can
// diverge later if download-specific tuning is needed.
export function computeDownloadMomentum(downloadsByPeriod: Record<string, number>): number {
  return computeRevenueAcceleration(downloadsByPeriod);
}

// ---------------------------------------------------------------------------
// Sub-Score 3: Anomaly Score (0-25)
// ---------------------------------------------------------------------------

export function computeAnomalyScore(
  revenueByPeriod: Record<string, number>,
  downloadsByPeriod: Record<string, number>
): number {
  const zScore = (values: Record<string, number>): number => {
    const sorted = Object.keys(values).sort();
    if (sorted.length < 3) return 0;
    const history = sorted.slice(0, -1).map(k => values[k]);
    const latest = values[sorted[sorted.length - 1]];
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance =
      history.reduce((sum, v) => sum + (v - mean) ** 2, 0) / history.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return latest > mean ? 3 : 0;
    return (latest - mean) / stddev;
  };

  const revZ = zScore(revenueByPeriod);
  const dlZ = zScore(downloadsByPeriod);
  const maxZ = Math.max(revZ, dlZ, 0);
  const normalized = Math.min((maxZ / 3) * 25, 25);
  return Math.round(normalized * 10) / 10;
}

// ---------------------------------------------------------------------------
// Sub-Score 4: Cross-Metric Convergence (0-25)
// ---------------------------------------------------------------------------

export function computeConvergence(
  revenueByPeriod: Record<string, number>,
  downloadsByPeriod: Record<string, number>
): number {
  const revChanges = percentChanges(revenueByPeriod);
  const dlChanges = percentChanges(downloadsByPeriod);
  if (revChanges.length === 0 || dlChanges.length === 0) return 0;

  const dlMap = new Map(dlChanges.map(c => [c.period, c.pctChange]));
  let convergenceScore = 0;
  let matchedPeriods = 0;

  for (const rc of revChanges) {
    const dlPct = dlMap.get(rc.period);
    if (dlPct === undefined) continue;
    matchedPeriods++;
    if (rc.pctChange > 0 && dlPct > 0) {
      const combined = Math.sqrt(rc.pctChange * dlPct);
      convergenceScore += Math.min(combined / 10, 5);
    } else if (rc.pctChange > 0 || dlPct > 0) {
      convergenceScore += 0.5;
    }
  }

  if (matchedPeriods === 0) return 0;
  const avgPerPeriod = convergenceScore / matchedPeriods;
  const normalized = Math.min(avgPerPeriod * 5, 25);
  return Math.round(normalized * 10) / 10;
}

// ---------------------------------------------------------------------------
// Composite Score
// ---------------------------------------------------------------------------

export function computeRisingStarScore(app: AppScoreInput): ScoredApp {
  const revAccel = computeRevenueAcceleration(app.revenueByPeriod);
  const dlMomentum = computeDownloadMomentum(app.downloadsByPeriod);
  const anomaly = computeAnomalyScore(app.revenueByPeriod, app.downloadsByPeriod);
  const convergence = computeConvergence(app.revenueByPeriod, app.downloadsByPeriod);

  return {
    appId: app.appId,
    appName: app.appName,
    publisherName: app.publisherName,
    score: Math.round((revAccel + dlMomentum + anomaly + convergence) * 10) / 10,
    subScores: {
      revenueAcceleration: revAccel,
      downloadMomentum: dlMomentum,
      anomalyScore: anomaly,
      crossMetricConvergence: convergence,
    },
  };
}

export function selectTopRisingStars(apps: AppScoreInput[], topN: number = 5): ScoredApp[] {
  const scored = apps.map(computeRisingStarScore);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
