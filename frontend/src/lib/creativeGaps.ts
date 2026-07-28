import type { CreativeFormat, QueryableAdNetwork } from '../types/creatives';
import type { JoinedCreative } from '../hooks/useCreativesForGenre';
import {
  DURATION_BUCKETS,
  durationBucket,
  type DurationBucket,
} from './creativeBuckets';

/**
 * Gap analysis shared by the band's YOUR GAP card, the gallery's "Your gaps"
 * tab, and the filter rail's Format/Length counts. Lifted verbatim from the old
 * FormatGapPanel so there is one source of truth for "competitors lean on this,
 * you don't touch it".
 */

/** Aggregate row: competitor volume/quality vs the focus app's own presence. */
export interface GapAgg<K extends string> {
  key: K;
  compCount: number;
  compGames: number;
  avgScore: number | null;
  focusCount: number;
  /** Network with the most competitor creatives in this bucket. */
  topNetwork: QueryableAdNetwork | null;
  /** compCount weighted by avg score — the "how strong for competitors" sort key. */
  strength: number;
}

function emptyAcc() {
  return {
    compCount: 0,
    compGames: new Set<string>(),
    scoreSum: 0,
    scored: 0,
    focusCount: 0,
    netCounts: new Map<QueryableAdNetwork, number>(),
  };
}
type Acc = ReturnType<typeof emptyAcc>;

function finalize<K extends string>(key: K, a: Acc): GapAgg<K> {
  const avgScore = a.scored > 0 ? Math.round(a.scoreSum / a.scored) : null;
  let topNetwork: QueryableAdNetwork | null = null;
  let topN = 0;
  for (const [net, n] of a.netCounts) {
    if (n > topN) {
      topN = n;
      topNetwork = net;
    }
  }
  return {
    key,
    compCount: a.compCount,
    compGames: a.compGames.size,
    avgScore,
    focusCount: a.focusCount,
    topNetwork,
    strength: a.compCount * (avgScore ?? 0),
  };
}

/**
 * Partition creatives into buckets by `keyOf`, splitting competitor vs
 * focus-app rows. `keyOf` returns null to skip a creative.
 */
export function aggregate<K extends string>(
  creatives: JoinedCreative[],
  focusAppId: string,
  order: readonly K[],
  keyOf: (c: JoinedCreative) => K | null,
): GapAgg<K>[] {
  const map = new Map<K, Acc>();
  for (const c of creatives) {
    const key = keyOf(c);
    if (key == null) continue;
    const acc = map.get(key) ?? emptyAcc();
    if (c.appId === focusAppId) {
      acc.focusCount += 1;
    } else {
      acc.compCount += 1;
      acc.compGames.add(c.appId);
      if (c.score != null) {
        acc.scoreSum += c.score;
        acc.scored += 1;
      }
      for (const n of c.networks) acc.netCounts.set(n, (acc.netCounts.get(n) ?? 0) + 1);
    }
    map.set(key, acc);
  }
  return order.filter((k) => map.has(k)).map((k) => finalize(k, map.get(k)!));
}

/** A row competitors lean on hard and the focus app doesn't touch at all. */
export function isGap(row: GapAgg<string>): boolean {
  return row.focusCount === 0 && row.compGames >= 2 && row.compCount >= 3;
}

const FORMAT_ORDER: readonly CreativeFormat[] = ['video', 'image', 'playable', 'unknown'];

export interface CreativeGaps {
  /** Length gaps (video only), strongest first. */
  lengths: GapAgg<DurationBucket>[];
  /** Format gaps, strongest first. */
  formats: GapAgg<CreativeFormat>[];
  /** Duration buckets flagged as gaps — for the tab preset + YOUR GAP action. */
  gapDurations: Set<string>;
  /** Formats flagged as gaps. */
  gapFormats: Set<CreativeFormat>;
}

/** Compute the format & length gaps for a workspace's creatives. */
export function computeCreativeGaps(creatives: JoinedCreative[], focusAppId: string): CreativeGaps {
  const videos = creatives.filter((c) => c.format === 'video');
  const lengths = aggregate<DurationBucket>(videos, focusAppId, DURATION_BUCKETS, (c) =>
    durationBucket(c.videoDurationSec),
  ).sort((a, b) => b.strength - a.strength);

  const formats = aggregate<CreativeFormat>(creatives, focusAppId, FORMAT_ORDER, (c) => c.format).sort(
    (a, b) => b.strength - a.strength,
  );

  const gapDurations = new Set<string>(
    lengths.filter((r) => r.key !== 'unknown' && isGap(r)).map((r) => r.key),
  );
  const gapFormats = new Set<CreativeFormat>(formats.filter((r) => isGap(r)).map((r) => r.key));

  return { lengths, formats, gapDurations, gapFormats };
}

/**
 * True when a creative sits in one of the focus app's gap buckets — the "Your
 * gaps" tab preset. A gap bucket is one competitors lean on and the focus app
 * has none of (see isGap).
 */
export function isCreativeInGap(
  c: JoinedCreative,
  gapFormats: Set<CreativeFormat>,
  gapDurations: Set<string>,
): boolean {
  if (gapFormats.has(c.format)) return true;
  if (c.format === 'video' && gapDurations.has(durationBucket(c.videoDurationSec))) return true;
  return false;
}
