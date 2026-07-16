import { useCallback, useRef, useState } from 'react';
import {
  analyzeGameWorkspace,
  fetchGameAppCreatives,
  type AnalyzeWorkspaceResult,
} from '../lib/creativesApi';
import { getCreativeWeekBounds } from '../lib/creativesWeek';

export type AppFetchState =
  | { state: 'queued' }
  | { state: 'fetching' }
  | { state: 'done'; count: number; cached: boolean }
  | { state: 'error'; message: string };

export type AnalysisPhase = 'idle' | 'fetching' | 'analyzing' | 'done' | 'error';

export interface WorkspaceAnalysisRun {
  phase: AnalysisPhase;
  /** Per-app fetch progress, keyed by appId. */
  appStatuses: Map<string, AppFetchState>;
  result: AnalyzeWorkspaceResult | null;
  error: string | null;
}

const IDLE: WorkspaceAnalysisRun = { phase: 'idle', appStatuses: new Map(), result: null, error: null };
const FETCH_CONCURRENCY = 3;

export interface AnalysisTarget {
  appId: string;
  name: string;
  publisherName?: string | null;
  iconUrl?: string | null;
}

/**
 * Client-side pipeline orchestrator: fetch each app's creatives (bounded
 * concurrency, per-app progress, app+week server cache), then run the
 * workspace analysis (scoring + Gemini). One function call per app keeps
 * every request far below the 540s limit and makes progress real.
 */
export function useWorkspaceAnalysis(week: string) {
  const [run, setRun] = useState<WorkspaceAnalysisRun>(IDLE);
  const runningRef = useRef(false);

  const setAppStatus = useCallback((appId: string, status: AppFetchState) => {
    setRun((prev) => {
      const next = new Map(prev.appStatuses);
      next.set(appId, status);
      return { ...prev, appStatuses: next };
    });
  }, []);

  const start = useCallback(
    async (
      focusApp: AnalysisTarget,
      competitors: AnalysisTarget[],
      country: string,
      opts: { force?: boolean; onAnalyzed?: () => void } = {},
    ) => {
      if (runningRef.current) return;
      runningRef.current = true;

      const targets = [focusApp, ...competitors];
      const { startDate, endDate } = getCreativeWeekBounds(week);

      setRun({
        phase: 'fetching',
        appStatuses: new Map(targets.map((t) => [t.appId, { state: 'queued' } as AppFetchState])),
        result: null,
        error: null,
      });

      let index = 0;
      const worker = async () => {
        while (true) {
          const i = index++;
          if (i >= targets.length) return;
          const t = targets[i];
          setAppStatus(t.appId, { state: 'fetching' });
          try {
            const r = await fetchGameAppCreatives({
              appId: t.appId,
              weekStart: startDate,
              weekEnd: endDate,
              country,
              force: opts.force,
              name: t.name,
              publisherName: t.publisherName ?? null,
              iconUrl: t.iconUrl ?? null,
            });
            setAppStatus(t.appId, { state: 'done', count: r.creativeCount, cached: r.cached });
          } catch (err) {
            setAppStatus(t.appId, {
              state: 'error',
              message: err instanceof Error ? err.message : 'Fetch failed.',
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, () => worker()),
      );

      setRun((prev) => ({ ...prev, phase: 'analyzing' }));
      try {
        const result = await analyzeGameWorkspace(
          focusApp.appId,
          focusApp.name,
          targets.map((t) => t.appId),
          week,
        );
        setRun((prev) => ({
          ...prev,
          phase: 'done',
          result,
          error: result.geminiError ?? null,
        }));
        opts.onAnalyzed?.();
      } catch (err) {
        setRun((prev) => ({
          ...prev,
          phase: 'error',
          error: err instanceof Error ? err.message : 'Analysis failed.',
        }));
      } finally {
        runningRef.current = false;
      }
    },
    [week, setAppStatus],
  );

  const reset = useCallback(() => {
    if (!runningRef.current) setRun(IDLE);
  }, []);

  return { run, start, reset };
}
