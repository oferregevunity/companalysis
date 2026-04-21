import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import { CreativeTile } from './CreativeTile';

export interface CreativeGalleryProps {
  creatives: JoinedCreative[];
  rankMap: Map<string, number>;
  appNames: Map<string, AppNameMapEntry>;
  onOpen: (docId: string) => void;
}

export function CreativeGallery({ creatives, rankMap, appNames, onOpen }: CreativeGalleryProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {creatives.map((c) => (
        <CreativeTile
          key={c.docId}
          creative={c}
          rankBadge={rankMap.get(c.docId)}
          appEntry={appNames.get(c.appId)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
