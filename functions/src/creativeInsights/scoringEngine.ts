import type { AdNetwork } from '../adIntel/types';

/**
 * Sub-score for how long a creative has been running.
 * Logarithmic curve calibrated so:
 *   7 days  → ~8
 *   30 days → ~18
 *   60+ days → 25 (cap)
 *
 * The ln(days+1)/ln(61) ratio is raised to 1.67 so the curve matches the
 * calibration; a naive linear log scale overshoots early-week scores.
 */
export function computeLongevity(days: number): number {
  if (days <= 0) return 0;
  if (days >= 60) return 25;
  const ratio = Math.log(days + 1) / Math.log(61);
  const scaled = 25 * Math.pow(ratio, 1.67);
  return Math.round(scaled * 10) / 10;
}

/**
 * Sub-score for cross-network breadth. A concept running on more networks
 * has more evidence of product/market fit. Linear 0→25 as network count
 * goes 0→7, capped at 7.
 */
export function computeNetworkBreadth(networks: readonly AdNetwork[]): number {
  const count = new Set(networks).size;
  if (count <= 0) return 0;
  const scaled = Math.min(25, (count / 7) * 25);
  return Math.round(scaled * 10) / 10;
}

function percentChanges(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev <= 0) continue;
    out.push(((values[i] - prev) / prev) * 100);
  }
  return out;
}

function accelerationScore(values: number[], maxPts: number): number {
  if (values.length < 2) return 0;
  const pct = percentChanges(values);
  if (pct.length === 0) return 0;
  let weighted = 0;
  let totalW = 0;
  pct.forEach((v, i) => {
    const w = i + 1;
    weighted += v * w;
    totalW += w;
  });
  const avg = weighted / totalW;
  if (avg <= 0) return 0;
  const base = Math.min(maxPts * 0.6, avg / 10);
  const accelerating = pct.length > 0 && pct.every(v => v > 0);
  const bonus = accelerating ? maxPts * 0.4 : 0;
  return Math.min(maxPts, Math.round((base + bonus) * 10) / 10);
}

export interface ImpressionMomentumInput {
  /** Share-of-voice per ISO week key (ordered lexicographically). */
  sovByWeek: Record<string, number>;
  /** Distinct-country count per week — fallback when SoV is empty. */
  countriesByWeek: Record<string, number>;
}

/**
 * Sub-score 0-25 for impression momentum. Prefers share-of-voice data when
 * available (needs ≥2 week observations); otherwise falls back to
 * distinct-country growth.
 *
 * KNOWN LIMITATION: Phase 2's scoring pipeline currently only has one
 * week's data per creative, so this sub-score is effectively 0 until the
 * pipeline is extended to aggregate multi-week SoV (see Phase 7 follow-up).
 */
export function computeImpressionMomentum(input: ImpressionMomentumInput): number {
  const sovKeys = Object.keys(input.sovByWeek).sort();
  if (sovKeys.length >= 2) {
    return accelerationScore(sovKeys.map(k => input.sovByWeek[k]), 25);
  }
  const countryKeys = Object.keys(input.countriesByWeek).sort();
  if (countryKeys.length >= 2) {
    return accelerationScore(countryKeys.map(k => input.countriesByWeek[k]), 25);
  }
  return 0;
}

/**
 * Sub-score for "proven but still fresh" — a creative is rewarded for
 * running ≥14 days but punished if its first appearance is older than 21
 * days (then it's no longer "emerging"). The 0.5 + 0.5 * ratio curve peaks
 * at 25 when first-seen age is low; at exactly 21 days since first seen,
 * ratio is 0 and the score is 12.5.
 */
export function computeFreshnessAdjustedPersistence(
  input: { firstSeen: string; durationDays: number },
  now: Date = new Date(),
): number {
  const firstSeenTs = Date.parse(input.firstSeen);
  if (!Number.isFinite(firstSeenTs)) return 0;
  const ageDays = (now.getTime() - firstSeenTs) / 86400000;
  if (ageDays > 21) return 0;
  if (input.durationDays < 14) return 0;
  const ratio = Math.max(0, (21 - ageDays) / 5);
  const pts = 25 * (0.5 + 0.5 * Math.min(1, ratio));
  return Math.min(25, Math.max(0, Math.round(pts * 10) / 10));
}

export interface SubScores {
  longevity: number;
  networkBreadth: number;
  impressionMomentum: number;
  freshnessAdjustedPersistence: number;
}

/**
 * Composite "Winning Creative Score" on a 0-100 scale. Each sub-score
 * contributes up to 25 points; the composite is their sum (not an average).
 */
export function computeWinningCreativeScore(s: SubScores): number {
  const sum = s.longevity + s.networkBreadth + s.impressionMomentum + s.freshnessAdjustedPersistence;
  return Math.round(Math.max(0, Math.min(100, sum)) * 10) / 10;
}

export function selectTopWinners<T extends { score: number }>(
  items: T[],
  topK: number,
  threshold: number,
): T[] {
  return items
    .filter(i => i.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
