import { describe, it, expect, vi } from 'vitest';
import { refreshRecentWorkspacesWithDeps, type WorkspaceToRefresh } from './refreshWorkspaces';

function ws(focusAppId: string, appIds: string[]): WorkspaceToRefresh {
  return { focusAppId, focusName: `Game ${focusAppId}`, country: 'US', appIds };
}

describe('refreshRecentWorkspacesWithDeps', () => {
  it('fetches every member app, analyzes, and marks each workspace refreshed', async () => {
    const fetchApp = vi.fn().mockResolvedValue({ success: true, cached: false });
    const analyze = vi.fn().mockResolvedValue({ success: true });
    const markRefreshed = vi.fn().mockResolvedValue(undefined);

    const result = await refreshRecentWorkspacesWithDeps({
      week: '2026-W29',
      loadRecentWorkspaces: async () => [ws('f1', ['f1', 'c1', 'c2']), ws('f2', ['f2', 'c1'])],
      fetchApp,
      analyze,
      markRefreshed,
    });

    expect(result.refreshed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(fetchApp).toHaveBeenCalledTimes(5); // dedupe happens server-side via cache markers
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(markRefreshed).toHaveBeenCalledWith('f1', '2026-W29');
    expect(markRefreshed).toHaveBeenCalledWith('f2', '2026-W29');
  });

  it('records per-app fetch failures but still analyzes and marks refreshed', async () => {
    const fetchApp = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 forever'))
      .mockResolvedValue({ success: true, cached: true });
    const analyze = vi.fn().mockResolvedValue({ success: true });
    const markRefreshed = vi.fn().mockResolvedValue(undefined);

    const result = await refreshRecentWorkspacesWithDeps({
      week: '2026-W29',
      loadRecentWorkspaces: async () => [ws('f1', ['f1', 'c1'])],
      fetchApp,
      analyze,
      markRefreshed,
    });

    expect(result.refreshed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('429 forever');
    expect(analyze).toHaveBeenCalledOnce();
    expect(markRefreshed).toHaveBeenCalledOnce();
  });

  it('surfaces gemini errors and stops starting workspaces past the deadline', async () => {
    let t = 0;
    const result = await refreshRecentWorkspacesWithDeps({
      week: '2026-W29',
      deadlineMs: 100,
      now: () => {
        t += 80;
        return t;
      },
      loadRecentWorkspaces: async () => [ws('f1', ['f1']), ws('f2', ['f2'])],
      fetchApp: vi.fn().mockResolvedValue({ success: true, cached: false }),
      analyze: vi.fn().mockResolvedValue({ success: false, geminiError: 'model exploded' }),
      markRefreshed: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.refreshed).toBe(1); // first ran (t=80 <= 100), second skipped (t=160)
    expect(result.skipped).toBe(1);
    expect(result.errors.some((e) => e.includes('model exploded'))).toBe(true);
    expect(result.errors.some((e) => e.includes('time budget'))).toBe(true);
  });
});
