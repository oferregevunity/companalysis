import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import type { CreativeTag } from '../../types/creatives';
import { CreativeTile } from './CreativeTile';

export interface CreativeGalleryProps {
  creatives: JoinedCreative[];
  rankMap: Map<string, number>;
  appNames: Map<string, AppNameMapEntry>;
  tagMap?: Map<string, CreativeTag>;
  focusAppId: string;
  onOpen: (docId: string) => void;
}

export function CreativeGallery({
  creatives,
  rankMap,
  appNames,
  tagMap,
  focusAppId,
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
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
