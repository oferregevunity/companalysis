import { useState } from 'react';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { CreativeFormat, CreativeTag } from '../../types/creatives';
import type { AppNameMapEntry } from '../../hooks/useAppNames';

const PLACEHOLDER_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80"><rect fill="#dfe0e8" width="64" height="80"/></svg>',
  );

function formatLabel(f: CreativeFormat): string {
  return f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1);
}

/** Pill label: "0:12" for videos with a duration, else the format name. */
function pillLabel(c: JoinedCreative): string {
  if (c.format === 'video' && c.videoDurationSec != null && c.videoDurationSec > 0) {
    const m = Math.floor(c.videoDurationSec / 60);
    const s = Math.round(c.videoDurationSec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  return formatLabel(c.format);
}

/** One evidence line: longevity · network breadth · share of voice. */
function evidenceLine(c: JoinedCreative): string {
  const parts = [`${c.durationDays}d live`, `${c.networks.length} network${c.networks.length === 1 ? '' : 's'}`];
  if (c.maxShare != null) parts.push(`${Math.round(c.maxShare * 100)}% SoV`);
  return parts.join(' · ');
}

export interface CreativeTileProps {
  creative: JoinedCreative;
  rankBadge?: number;
  appEntry?: AppNameMapEntry;
  tag?: CreativeTag;
  isOwn?: boolean;
  onOpen: (docId: string) => void;
}

export function CreativeTile({ creative, rankBadge, appEntry, tag, isOwn, onOpen }: CreativeTileProps) {
  const displayName = appEntry?.name ?? creative.appId;

  // Chrome caps WebMediaPlayer instances per tab (~75). Render the poster by
  // default and only swap to <video> while hovered/focused so at most a handful
  // of players are ever alive.
  const [isHovering, setIsHovering] = useState(false);
  const isVideo = creative.format === 'video' && !!creative.mediaUrl;
  // Playables get the same play affordance, but no hover-preview — we don't want
  // to spin up an iframe per tile. Tapping opens the modal, which plays the HTML.
  const isPlayable = creative.format === 'playable' && !!creative.htmlUrl;
  const poster = creative.thumbnailUrl ?? creative.mediaUrl ?? PLACEHOLDER_SVG;

  const hookTheme = tag ? [tag.hookType, ...(tag.themes[0] ? [tag.themes[0]] : [])].join(' · ') : null;

  return (
    <div
      id={`creative-${creative.docId}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(creative.docId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(creative.docId);
        }
      }}
      onMouseEnter={() => isVideo && setIsHovering(true)}
      onMouseLeave={() => isVideo && setIsHovering(false)}
      onFocus={() => isVideo && setIsHovering(true)}
      onBlur={() => isVideo && setIsHovering(false)}
      className="cursor-pointer overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-accent-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="relative aspect-[4/5] bg-[#dfe0e8]">
        {isVideo && isHovering ? (
          <video
            src={creative.mediaUrl!}
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            poster={creative.thumbnailUrl ?? undefined}
            className="h-full w-full object-cover"
          />
        ) : (
          <>
            <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
            {(isVideo || isPlayable) && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(22,23,31,0.55)]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            )}
          </>
        )}

        {rankBadge != null && (
          <span className="absolute left-2 top-2 rounded-md bg-ink px-[7px] py-0.5 text-[11px] font-semibold text-white">
            #{rankBadge}
          </span>
        )}
        {creative.score != null && (
          <span className="absolute right-2 top-2 rounded-md border border-accent-border bg-[rgba(255,255,255,0.94)] px-[7px] py-0.5 text-[11px] font-semibold text-accent-text">
            {creative.score}
          </span>
        )}
        <span className="absolute bottom-2 left-2 rounded-[5px] bg-[rgba(22,23,31,0.7)] px-1.5 py-px text-[10px] text-white">
          {pillLabel(creative)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 px-3 pb-3 pt-[11px]">
        <div className="flex items-center gap-2">
          {appEntry?.iconUrl ? (
            <img src={appEntry.iconUrl} alt="" className="h-4 w-4 shrink-0 rounded" loading="lazy" />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded bg-hairline" />
          )}
          <span className="min-w-0 truncate text-xs font-medium text-ink">
            {displayName}
            {isOwn && <span className="text-accent-text"> · yours</span>}
          </span>
        </div>
        {hookTheme && <p className="truncate text-xs text-ink-2">{hookTheme}</p>}
        <p className="truncate text-[11px] text-ink-muted">{evidenceLine(creative)}</p>
      </div>
    </div>
  );
}
