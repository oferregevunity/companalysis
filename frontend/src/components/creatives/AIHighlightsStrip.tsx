import { useMemo } from 'react';
import type { CreativeInsightDoc } from '../../types/creatives';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';

const THUMB_CLASS = 'w-14 h-14 rounded-md object-cover bg-gray-100 shrink-0 border border-gray-100';

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
      <div className="h-4 w-1/3 rounded bg-gray-200 mb-3" />
      <div className="space-y-2">
        <div className="h-3 rounded bg-gray-100" />
        <div className="h-3 w-5/6 rounded bg-gray-100" />
        <div className="h-3 w-2/3 rounded bg-gray-100" />
      </div>
    </div>
  );
}

export interface AIHighlightsStripProps {
  insightDoc: CreativeInsightDoc | null;
  joinedCreatives: JoinedCreative[];
  loading: boolean;
  onScrollToCreative: (docId: string) => void;
}

export function AIHighlightsStrip({
  insightDoc,
  joinedCreatives,
  loading,
  onScrollToCreative,
}: AIHighlightsStripProps) {
  const byDocId = useMemo(() => {
    const m = new Map<string, JoinedCreative>();
    for (const c of joinedCreatives) {
      m.set(c.docId, c);
    }
    return m;
  }, [joinedCreatives]);

  if (insightDoc === null && loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (insightDoc === null && !loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
        No analysis yet — click Re-analyze to generate.
      </div>
    );
  }

  if (!insightDoc) {
    return null;
  }

  const degraded = !insightDoc.summary?.trim() || Boolean(insightDoc.geminiError);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Genre summary</h3>
        {degraded ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 border border-amber-100">
            <p>AI insights unavailable for this run, showing statistical scores only.</p>
            {insightDoc.geminiError && (
              <p className="mt-1 text-xs text-amber-700 break-words" title={insightDoc.geminiError}>
                {insightDoc.geminiError.slice(0, 300)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600 leading-relaxed bg-blue-50 p-3 rounded-lg">{insightDoc.summary}</p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Emerging concepts</h3>
        <ul className="space-y-4">
          {insightDoc.emergingConcepts.slice(0, 3).map((c, i) => (
            <li key={i}>
              <p className="text-sm font-medium text-gray-900">{c.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">{c.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.exampleCreativeIds.slice(0, 4).map((id) => {
                  const cr = byDocId.get(id);
                  const src = cr?.thumbnailUrl ?? cr?.previewUrl ?? cr?.mediaUrl ?? undefined;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onScrollToCreative(id)}
                      className="rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                      title="Scroll to creative"
                    >
                      {src ? (
                        <img src={src} alt="" className={THUMB_CLASS} />
                      ) : (
                        <div className={THUMB_CLASS} />
                      )}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        {insightDoc.emergingConcepts.length === 0 && (
          <p className="text-sm text-gray-400">No emerging concepts.</p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Watch list</h3>
        <ul className="space-y-3">
          {insightDoc.watchList.slice(0, 3).map((w) => (
            <li key={w.creativeId} className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-gray-900">{w.appName}</span>
                <span className="text-xs font-medium tabular-nums text-gray-700 shrink-0">{w.score}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{w.reason}</p>
            </li>
          ))}
        </ul>
        {insightDoc.watchList.length === 0 && (
          <p className="text-sm text-gray-400">No watch list entries.</p>
        )}
      </div>
    </div>
  );
}
