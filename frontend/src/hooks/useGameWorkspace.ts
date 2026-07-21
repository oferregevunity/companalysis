import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { DiscoveredCompetitor, SearchedGame } from '../lib/creativesApi';

/** `gameWorkspaces/{focusAppId}` — the team-shared unit of analysis. */
export interface GameWorkspace {
  focusApp: SearchedGame;
  competitors: DiscoveredCompetitor[];
  /** Curated subset of competitor appIds included in analysis. */
  selectedIds: string[];
  country: string;
  lastAnalyzedWeek: string | null;
  updatedAt?: { seconds: number } | Date | null;
}

function sanitize(raw: Record<string, unknown>): GameWorkspace | null {
  const focusApp = raw.focusApp as SearchedGame | undefined;
  if (!focusApp || typeof focusApp.appId !== 'string') return null;
  return {
    focusApp,
    competitors: Array.isArray(raw.competitors) ? (raw.competitors as DiscoveredCompetitor[]) : [],
    selectedIds: Array.isArray(raw.selectedIds) ? (raw.selectedIds as string[]) : [],
    country: typeof raw.country === 'string' && raw.country ? raw.country : 'US',
    lastAnalyzedWeek: typeof raw.lastAnalyzedWeek === 'string' ? raw.lastAnalyzedWeek : null,
    updatedAt: (raw.updatedAt as GameWorkspace['updatedAt']) ?? null,
  };
}

/**
 * Live view of one game's workspace doc plus a saver. `workspace` is null
 * while loading or when the game has never been analyzed by anyone.
 */
export function useGameWorkspace(focusAppId: string | null) {
  const [state, setState] = useState<{
    forId: string | null;
    workspace: GameWorkspace | null;
    loaded: boolean;
  }>({ forId: focusAppId, workspace: null, loaded: false });

  // Reset synchronously when the focused game changes (render-time state
  // adjustment — avoids a stale workspace flashing for the new game).
  if (state.forId !== focusAppId) {
    setState({ forId: focusAppId, workspace: null, loaded: false });
  }

  useEffect(() => {
    if (!focusAppId) {
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'gameWorkspaces', focusAppId),
      (snap) => {
        setState({
          forId: focusAppId,
          workspace: snap.exists() ? sanitize(snap.data() as Record<string, unknown>) : null,
          loaded: true,
        });
      },
      (err) => {
        console.error('useGameWorkspace', err);
        setState({ forId: focusAppId, workspace: null, loaded: true });
      },
    );
    return () => unsub();
  }, [focusAppId]);

  const workspace = state.forId === focusAppId ? state.workspace : null;
  const loaded = state.forId === focusAppId ? state.loaded : false;

  const save = useCallback(async (ws: GameWorkspace) => {
    await setDoc(
      doc(db, 'gameWorkspaces', ws.focusApp.appId),
      {
        focusApp: ws.focusApp,
        competitors: ws.competitors,
        selectedIds: ws.selectedIds,
        country: ws.country,
        lastAnalyzedWeek: ws.lastAnalyzedWeek,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }, []);

  return { workspace, loaded, save };
}

export interface RecentWorkspace {
  focusApp: SearchedGame;
  lastAnalyzedWeek: string | null;
  updatedAt: Date | null;
}

/** Most recently used workspaces across the team — the "saved for next time" row. */
export function useRecentWorkspaces(max = 8) {
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'gameWorkspaces'), orderBy('updatedAt', 'desc'), limit(max)),
        );
        const rows: RecentWorkspace[] = [];
        for (const d of snap.docs) {
          const ws = sanitize(d.data() as Record<string, unknown>);
          if (!ws) continue;
          const u = ws.updatedAt;
          rows.push({
            focusApp: ws.focusApp,
            lastAnalyzedWeek: ws.lastAnalyzedWeek,
            updatedAt:
              u instanceof Date ? u : u && 'seconds' in u ? new Date(u.seconds * 1000) : null,
          });
        }
        if (!cancelled) setRecent(rows);
      } catch (err) {
        console.error('useRecentWorkspaces', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [max]);

  // Delete a game's workspace doc and drop it from the row (optimistic).
  const remove = useCallback(async (appId: string) => {
    setRecent((prev) => prev.filter((r) => r.focusApp.appId !== appId));
    try {
      await deleteDoc(doc(db, 'gameWorkspaces', appId));
    } catch (err) {
      console.error('useRecentWorkspaces remove', err);
    }
  }, []);

  return { recent, remove };
}
