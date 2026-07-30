import type { JoinedCreative } from '../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../hooks/useAppNames';
import type { CreativeInsightDoc, CreativeFormat, VideoAnalysis } from '../types/creatives';

/**
 * Assembles the fields shown in the side-by-side compare panel (#5) for one
 * creative, pulling from the joined creative + the insight doc (winner/watch
 * reason, hook/theme tag, deep video analysis). Pure so it's trivially testable
 * and the modal stays a dumb renderer. Hook/theme prefer the grounded video
 * analysis when present, else fall back to the metadata tag.
 */

export interface CompareItem {
  docId: string;
  appId: string;
  name: string;
  iconUrl: string | null;
  poster: string | null;
  score: number | null;
  format: CreativeFormat;
  /** "0:31" for videos with a duration, else null. */
  lengthLabel: string | null;
  networks: string[];
  /** Share of voice as a rounded percent, or null. */
  maxSharePct: number | null;
  durationDays: number;
  hookType: string | null;
  themes: string[];
  motivations: string[];
  whyItWins: string | null;
  videoAnalysis: VideoAnalysis | null;
}

function lengthLabel(c: JoinedCreative): string | null {
  if (c.format !== 'video' || c.videoDurationSec == null || c.videoDurationSec <= 0) return null;
  const m = Math.floor(c.videoDurationSec / 60);
  const s = Math.round(c.videoDurationSec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function buildCompareItem(
  c: JoinedCreative,
  insightDoc: CreativeInsightDoc | null,
  appEntry: AppNameMapEntry | undefined,
): CompareItem {
  const winner = insightDoc?.winners.find((w) => w.creativeId === c.docId);
  const watch = insightDoc?.watchList.find((w) => w.creativeId === c.docId);
  const tag = insightDoc?.creativeTags?.find((t) => t.creativeId === c.docId);
  const va = insightDoc?.videoAnalyses?.find((v) => v.creativeId === c.docId) ?? null;

  return {
    docId: c.docId,
    appId: c.appId,
    name: appEntry?.name ?? c.appId,
    iconUrl: appEntry?.iconUrl ?? null,
    poster: c.thumbnailUrl ?? c.mediaUrl ?? null,
    score: c.score ?? null,
    format: c.format,
    lengthLabel: lengthLabel(c),
    networks: c.networks,
    maxSharePct: c.maxShare != null ? Math.round(c.maxShare * 100) : null,
    durationDays: c.durationDays,
    hookType: va?.hookType ?? tag?.hookType ?? null,
    themes: va?.themes?.length ? va.themes : tag?.themes ?? [],
    motivations: va?.motivations ?? [],
    whyItWins: winner?.explanation ?? watch?.reason ?? null,
    videoAnalysis: va,
  };
}
