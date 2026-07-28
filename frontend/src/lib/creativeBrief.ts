import type { JoinedCreative } from '../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../hooks/useAppNames';
import type { CreativeTag } from '../types/creatives';
import { durationBucket } from './creativeBuckets';

function formatLabel(f: JoinedCreative['format']): string {
  return f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1);
}

/** Human video length, e.g. "0:12" — falls back to the coarse bucket. */
function lengthLabel(c: JoinedCreative): string {
  const s = c.videoDurationSec;
  if (c.format !== 'video') return '—';
  if (s != null && Number.isFinite(s) && s > 0) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }
  return durationBucket(s);
}

/**
 * Build a markdown creative brief for the "Copy as brief" action, so a winning
 * idea can be pasted straight into a brief doc. Pure — the detail dialog copies
 * the returned string to the clipboard.
 */
export function buildBrief(
  creative: JoinedCreative,
  tag: CreativeTag | undefined,
  appEntry: AppNameMapEntry | undefined,
  whyItWins: string | null,
): string {
  const game = appEntry?.name ?? creative.appId;
  const lines: string[] = [];

  lines.push(`# Creative brief — inspired by ${game}`);
  lines.push('');
  if (tag?.hookType) lines.push(`- **Hook:** ${tag.hookType}`);
  if (tag && tag.themes.length > 0) lines.push(`- **Themes:** ${tag.themes.join(', ')}`);
  lines.push(`- **Format:** ${formatLabel(creative.format)}`);
  if (creative.format === 'video') lines.push(`- **Length:** ${lengthLabel(creative)}`);
  if (creative.networks.length > 0) lines.push(`- **Networks:** ${creative.networks.join(', ')}`);
  lines.push(`- **Live:** ${creative.durationDays}d (first seen ${creative.firstSeen})`);
  if (creative.maxShare != null) lines.push(`- **Share of voice:** ${Math.round(creative.maxShare * 100)}%`);
  if (creative.score != null) lines.push(`- **Score:** ${creative.score}`);

  if (whyItWins) {
    lines.push('');
    lines.push('## Why it wins');
    lines.push(whyItWins);
  }

  lines.push('');
  return lines.join('\n');
}
