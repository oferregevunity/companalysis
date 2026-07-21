import { useMemo } from 'react';
import type { CreativeFormat, QueryableAdNetwork } from '../../types/creatives';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import {
  ASPECT_BUCKETS,
  DURATION_BUCKETS,
  aspectBucket,
  aspectLabel,
  durationBucket,
  type AspectBucket,
  type DurationBucket,
} from '../../lib/creativeBuckets';

export interface FormatGapPanelProps {
  /** All workspace creatives (focus app + competitors), already score-joined. */
  creatives: JoinedCreative[];
  /** The focused game — "you". Everything else is a competitor. */
  focusAppId: string;
  selectedFormats: Set<CreativeFormat>;
  selectedDurationBuckets: Set<string>;
  onToggleFormat: (format: CreativeFormat) => void;
  onToggleDurationBucket: (bucket: string) => void;
}

/** Aggregate row: competitor volume/quality vs the focus app's own presence. */
interface GapAgg<K extends string> {
  key: K;
  compCount: number;
  compGames: number;
  avgScore: number | null;
  focusCount: number;
  /** Network with the most competitor creatives in this bucket (length card only). */
  topNetwork: QueryableAdNetwork | null;
  /** compCount weighted by avg score — the "how strong is this for competitors" sort key. */
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
 * Generic aggregation: partition creatives into buckets by `keyOf`, splitting
 * competitor vs focus-app rows. `keyOf` returns null to skip a creative.
 */
function aggregate<K extends string>(
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

function formatLabel(f: CreativeFormat): string {
  return f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1);
}

/** A row that competitors lean on hard and the focus app doesn't touch at all. */
function isGap(row: GapAgg<string>): boolean {
  return row.focusCount === 0 && row.compGames >= 2 && row.compCount >= 3;
}

const BAR_COLORS = ['bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-sky-500'];

export function FormatGapPanel({
  creatives,
  focusAppId,
  selectedFormats,
  selectedDurationBuckets,
  onToggleFormat,
  onToggleDurationBucket,
}: FormatGapPanelProps) {
  const { lengths, formats, aspects, headline } = useMemo(() => {
    // Length is only meaningful for video; non-video has no duration.
    const videos = creatives.filter((c) => c.format === 'video');
    const lengths = aggregate<DurationBucket>(videos, focusAppId, DURATION_BUCKETS, (c) =>
      durationBucket(c.videoDurationSec),
    ).sort((a, b) => b.strength - a.strength);

    const formats = aggregate<CreativeFormat>(
      creatives,
      focusAppId,
      ['video', 'image', 'playable', 'unknown'],
      (c) => c.format,
    ).sort((a, b) => b.strength - a.strength);

    const aspects = aggregate<AspectBucket>(creatives, focusAppId, ASPECT_BUCKETS, (c) =>
      aspectBucket(c.width, c.height),
    ).sort((a, b) => b.strength - a.strength);

    // Headline = the strongest length gap if one exists, else the strongest length bucket overall.
    const lengthGaps = lengths.filter((r) => r.key !== 'unknown' && isGap(r));
    const top = (lengthGaps[0] ?? lengths.find((r) => r.key !== 'unknown')) || null;
    let headline: string | null = null;
    if (top) {
      const net = top.topNetwork ? ` on ${top.topNetwork}` : '';
      const score = top.avgScore != null ? `, avg score ${top.avgScore}` : '';
      const you =
        top.focusCount === 0
          ? ' — you have none.'
          : ` — you run ${top.focusCount}.`;
      headline = `Competitors run ${top.key} videos${net} (${top.compCount} creatives, ${top.compGames} games${score})${you}`;
    }

    return { lengths, formats, aspects, headline };
  }, [creatives, focusAppId]);

  const hasComp = creatives.some((c) => c.appId !== focusAppId);
  if (!hasComp) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Formats &amp; lengths you're missing</h3>
        <span className="text-[11px] text-gray-400">
          "Strong" = longevity + network breadth + share-of-voice (no spend data)
        </span>
      </div>

      {headline && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
          {headline}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LengthCard
          rows={lengths}
          selected={selectedDurationBuckets}
          onToggle={onToggleDurationBucket}
        />
        <FormatCard rows={formats} selected={selectedFormats} onToggle={onToggleFormat} />
        <AspectCard rows={aspects} />
      </div>
    </div>
  );
}

function GapBadge({ row }: { row: GapAgg<string> }) {
  if (row.focusCount === 0) {
    return (
      <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-100">
        You: 0
      </span>
    );
  }
  return <span className="shrink-0 text-[10px] font-medium text-gray-400">You: {row.focusCount}</span>;
}

function LengthCard({
  rows,
  selected,
  onToggle,
}: {
  rows: GapAgg<DurationBucket>[];
  selected: Set<string>;
  onToggle: (b: string) => void;
}) {
  const max = rows[0]?.compCount ?? 1;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-gray-800">Video length</h4>
      <p className="mb-2 text-[11px] text-gray-400">Competitor videos by length · click to filter</p>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const on = selected.has(r.key);
          const gap = r.key !== 'unknown' && isGap(r);
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onToggle(r.key)}
                className={`group w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                  on ? 'bg-blue-50 ring-1 ring-blue-300' : gap ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-gray-800">{r.key}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="tabular-nums text-gray-500">{r.compCount}</span>
                    {r.avgScore != null && <span className="text-gray-400">avg {r.avgScore}</span>}
                    <GapBadge row={r} />
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="block h-1.5 flex-1 rounded-full bg-gray-100">
                    <span
                      className={`block h-1.5 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                      style={{ width: `${Math.max((r.compCount / max) * 100, 6)}%` }}
                    />
                  </span>
                  {r.topNetwork && (
                    <span className="shrink-0 text-[10px] text-gray-400">{r.topNetwork}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-xs text-gray-400">No competitor videos.</li>}
      </ul>
    </div>
  );
}

function FormatCard({
  rows,
  selected,
  onToggle,
}: {
  rows: GapAgg<CreativeFormat>[];
  selected: Set<CreativeFormat>;
  onToggle: (f: CreativeFormat) => void;
}) {
  const max = rows[0]?.compCount ?? 1;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-gray-800">Format</h4>
      <p className="mb-2 text-[11px] text-gray-400">Video · image · playable · click to filter</p>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const on = selected.has(r.key);
          const gap = isGap(r);
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onToggle(r.key)}
                className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                  on ? 'bg-blue-50 ring-1 ring-blue-300' : gap ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-gray-800">{formatLabel(r.key)}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="tabular-nums text-gray-500">{r.compCount}</span>
                    {r.avgScore != null && <span className="text-gray-400">avg {r.avgScore}</span>}
                    <GapBadge row={r} />
                  </span>
                </span>
                <span className="mt-1 block h-1.5 w-full rounded-full bg-gray-100">
                  <span
                    className={`block h-1.5 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                    style={{ width: `${Math.max((r.compCount / max) * 100, 6)}%` }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AspectCard({ rows }: { rows: GapAgg<AspectBucket>[] }) {
  const max = rows[0]?.compCount ?? 1;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-gray-800">Aspect ratio</h4>
      <p className="mb-2 text-[11px] text-gray-400">Orientation of competitor creatives</p>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const gap = r.key !== 'unknown' && isGap(r);
          return (
            <li
              key={r.key}
              className={`rounded-lg px-2 py-1.5 ${gap ? 'bg-amber-50/60' : ''}`}
            >
              <span className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-gray-800">{aspectLabel(r.key)}</span>
                <span className="flex items-center gap-1.5">
                  <span className="tabular-nums text-gray-500">{r.compCount}</span>
                  {r.avgScore != null && <span className="text-gray-400">avg {r.avgScore}</span>}
                  <GapBadge row={r} />
                </span>
              </span>
              <span className="mt-1 block h-1.5 w-full rounded-full bg-gray-100">
                <span
                  className={`block h-1.5 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  style={{ width: `${Math.max((r.compCount / max) * 100, 6)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
