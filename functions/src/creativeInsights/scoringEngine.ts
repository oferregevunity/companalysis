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
