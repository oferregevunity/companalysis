export interface WorkspaceToRefresh {
  focusAppId: string;
  focusName: string;
  country: string;
  appIds: string[];
}

export interface RefreshDeps {
  loadRecentWorkspaces: () => Promise<WorkspaceToRefresh[]>;
  fetchApp: (appId: string, country: string) => Promise<{ success: boolean; cached: boolean }>;
  analyze: (ws: WorkspaceToRefresh) => Promise<{ success: boolean; geminiError?: string }>;
  markRefreshed: (focusAppId: string, week: string) => Promise<void>;
  week: string;
  /** Stop starting new workspaces after this deadline (ms epoch). */
  deadlineMs?: number;
  now?: () => number;
}

export interface RefreshResult {
  refreshed: number;
  skipped: number;
  errors: string[];
}

/**
 * Weekly auto-refresh for recently-used game workspaces: re-fetch each
 * member app's creatives for the new week (the shared app+week cache dedupes
 * overlap across workspaces) and re-run scoring + Gemini. Sequential by
 * design — Sensor Tower rate limits are the bottleneck, and the time budget
 * stops us before the function deadline.
 */
export async function refreshRecentWorkspacesWithDeps(deps: RefreshDeps): Promise<RefreshResult> {
  const { loadRecentWorkspaces, fetchApp, analyze, markRefreshed, week } = deps;
  const now = deps.now ?? Date.now;
  const errors: string[] = [];
  let refreshed = 0;
  let skipped = 0;

  const workspaces = await loadRecentWorkspaces();
  for (const ws of workspaces) {
    if (deps.deadlineMs && now() > deps.deadlineMs) {
      skipped += 1;
      errors.push(`[${ws.focusName}] skipped: time budget exhausted`);
      continue;
    }
    try {
      for (const appId of ws.appIds) {
        try {
          await fetchApp(appId, ws.country);
        } catch (err) {
          errors.push(`[${ws.focusName}] fetch ${appId}: ${err instanceof Error ? err.message : err}`);
        }
      }
      const result = await analyze(ws);
      if (result.geminiError) {
        errors.push(`[${ws.focusName}] gemini: ${result.geminiError}`);
      }
      await markRefreshed(ws.focusAppId, week);
      refreshed += 1;
    } catch (err) {
      errors.push(`[${ws.focusName}] ${err instanceof Error ? err.message : err}`);
    }
  }

  return { refreshed, skipped, errors };
}

const RECENT_DAYS = 30;

/** Firestore-bound entry used by the Monday scheduled job. */
export async function refreshRecentWorkspaces(params: {
  authToken: string;
  weekStart: string;
  weekEnd: string;
  deadlineMs?: number;
}): Promise<RefreshResult> {
  const [{ getFirestore, FieldValue, Timestamp }, { fetchAppCreativesForWeek }, { analyzeGameWorkspace }, { weekKeyFromStart }] =
    await Promise.all([
      import('firebase-admin/firestore'),
      import('./fetchAppWeek'),
      import('./analyze'),
      import('../adIntel/fetchCreativesForGenre'),
    ]);

  const db = getFirestore('companalysis');
  const week = weekKeyFromStart(params.weekStart);
  const cutoff = Timestamp.fromMillis(Date.now() - RECENT_DAYS * 86400000);

  return refreshRecentWorkspacesWithDeps({
    week,
    deadlineMs: params.deadlineMs,
    loadRecentWorkspaces: async () => {
      // `updatedAt` reflects human use only; auto-refresh writes a separate
      // field so idle workspaces age out of the window naturally.
      const snap = await db
        .collection('gameWorkspaces')
        .where('updatedAt', '>=', cutoff)
        .get();
      const out: WorkspaceToRefresh[] = [];
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const focusApp = data.focusApp as { appId?: string; name?: string } | undefined;
        if (!focusApp?.appId) continue;
        const selectedIds = Array.isArray(data.selectedIds) ? (data.selectedIds as string[]) : [];
        out.push({
          focusAppId: focusApp.appId,
          focusName: focusApp.name || focusApp.appId,
          country: typeof data.country === 'string' && data.country ? data.country : 'US',
          appIds: [...new Set([focusApp.appId, ...selectedIds])],
        });
      }
      return out;
    },
    fetchApp: async (appId, country) => {
      const r = await fetchAppCreativesForWeek({
        appId,
        country,
        weekStart: params.weekStart,
        weekEnd: params.weekEnd,
        authToken: params.authToken,
      });
      return { success: r.success, cached: r.cached };
    },
    analyze: (ws) =>
      analyzeGameWorkspace({
        focusAppId: ws.focusAppId,
        focusName: ws.focusName,
        appIds: ws.appIds,
        week,
      }),
    markRefreshed: async (focusAppId, wk) => {
      await db.collection('gameWorkspaces').doc(focusAppId).set(
        { lastAnalyzedWeek: wk, lastAutoRefreshAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    },
  });
}
