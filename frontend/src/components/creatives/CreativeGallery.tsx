import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import type { CreativeTag } from '../../types/creatives';
import type { VariantMeta } from '../../lib/creativeVariants';
import { CreativeTile } from './CreativeTile';

export interface CreativeGalleryProps {
  creatives: JoinedCreative[];
  rankMap: Map<string, number>;
  appNames: Map<string, AppNameMapEntry>;
  tagMap?: Map<string, CreativeTag>;
  /** Variant-group metadata keyed by docId (see groupVariants); empty when grouping is off. */
  variantMeta?: Map<string, VariantMeta>;
  focusAppId: string;
  /** Compare-mode: tiles select for comparison instead of opening detail. */
  compareMode?: boolean;
  comparingIds?: Set<string>;
  onToggleCompare?: (docId: string) => void;
  onOpen: (docId: string) => void;
}

export function CreativeGallery({
  creatives,
  rankMap,
  appNames,
  tagMap,
  variantMeta,
  focusAppId,
  compareMode,
  comparingIds,
  onToggleCompare,
  onOpen,
}: CreativeGalleryProps) {
  return (
    <div className="grid grid-cols-2 gap-4 pt-[18px] sm:grid-cols-3 lg:grid-cols-4">
      {creatives.map((c) => (
        <CreativeTile
          key={c.docId}
          creative={c}
          rankBadge={rankMap.get(c.docId)}
          appEntry={appNames.get(c.appId)}
          tag={tagMap?.get(c.docId)}
          isOwn={c.appId === focusAppId}
          variant={variantMeta?.get(c.docId)}
          compareMode={compareMode}
          isComparing={comparingIds?.has(c.docId)}
          onToggleCompare={onToggleCompare}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
