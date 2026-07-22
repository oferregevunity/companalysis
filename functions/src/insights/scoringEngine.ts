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

/** Minimum daily revenue a base period must clear for its growth to count fully.
 * Below this, the revenue-acceleration contribution ramps linearly down to 0. */
const MIN_DAILY_REVENUE = 500;

/** Number of days in a period key ("2025-W03" → 7, "2025-01" → days in that month).
 * Used to convert period revenue totals into a daily rate. */
function daysInPeriod(period: string): number {
  if (period.includes('W')) return 7;
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

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

/**
 * Core acceleration math shared by revenue and downloads.
 *
 * `magWeightByPeriod` (keyed by the later period of each change, matching
 * `percentChanges`) is an optional 0-1 multiplier that scales how much each
 * change contributes. When omitted, every change counts fully — identical to
 * the original percentage-only behavior.
 */
function accelerationScore(
  valuesByPeriod: Record<string, number>,
  magWeightByPeriod?: Record<string, number>
): number {
  const changes = percentChanges(valuesByPeriod);
  if (changes.length === 0) return 0;

  const recencyWeights = changes.map((_, i) => i + 1);
  const totalRecency = recencyWeights.reduce((a, b) => a + b, 0);

  const magFor = (period: string) =>
    magWeightByPeriod ? magWeightByPeriod[period] ?? 0 : 1;

  const weightedAvg =
    changes.reduce(
      (sum, c, i) => sum + c.pctChange * recencyWeights[i] * magFor(c.period),
      0
    ) / totalRecency;

  if (weightedAvg <= 0) return 0;

  let accelerationBonus = 0;
  if (changes.length >= 2) {
    let accelerating = 0;
    for (let i = 1; i < changes.length; i++) {
      if (changes[i].pctChange > changes[i - 1].pctChange) accelerating++;
    }
    accelerationBonus = (accelerating / (changes.length - 1)) * 10;
  }

  // Scale the acceleration bonus by the same recency-weighted magnitude so a
  // fully sub-floor app can't earn points purely from an accelerating shape.
  const magFactor =
    changes.reduce((s, c, i) => s + magFor(c.period) * recencyWeights[i], 0) /
    totalRecency;
  accelerationBonus *= magFactor;

  const baseScore = Math.min(weightedAvg / 10, 15);
  const raw = baseScore + accelerationBonus;
  return Math.min(Math.round(raw * 10) / 10, 25);
}

// ---------------------------------------------------------------------------
// Sub-Score 1: Revenue Acceleration (0-25)
// ---------------------------------------------------------------------------

export function computeRevenueAcceleration(revenueByPeriod: Record<string, number>): number {
  // Weight each change by how far its BASE (earlier) period cleared the
  // $500/day floor: 0 below $0, ramping to full at MIN_DAILY_REVENUE. A $0 base
  // gets weight 0, so the +100% zero-baseline case no longer inflates the score.
  const sorted = Object.keys(revenueByPeriod).sort();
  const magWeightByPeriod: Record<string, number> = {};
  for (let i = 1; i < sorted.length; i++) {
    const basePeriod = sorted[i - 1];
    const baseDaily = revenueByPeriod[basePeriod] / daysInPeriod(basePeriod);
    magWeightByPeriod[sorted[i]] = Math.max(0, Math.min(baseDaily / MIN_DAILY_REVENUE, 1));
  }
  return accelerationScore(revenueByPeriod, magWeightByPeriod);
}

// ---------------------------------------------------------------------------
// Sub-Score 2: Download Momentum (0-25)
// ---------------------------------------------------------------------------

// Same shape as revenue acceleration, but WITHOUT the revenue magnitude gate —
// downloads are counted on percentage change alone (revenue-only floor, for now).
export function computeDownloadMomentum(downloadsByPeriod: Record<string, number>): number {
  return accelerationScore(downloadsByPeriod);
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
