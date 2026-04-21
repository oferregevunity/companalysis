import { describe, it, expect, vi } from 'vitest';
import { resolveAppsInScope } from './appsInScope';

describe('resolveAppsInScope', () => {
  it('returns top N by revenue, capped to N', async () => {
    const loader = async () => [
      { appId: 'a', revenue: 100 },
      { appId: 'b', revenue: 50 },
      { appId: 'c', revenue: 25 },
    ];
    const result = await resolveAppsInScope({
      genreId: 'g1',
      topN: 2,
      loadLatestSnapshotApps: loader,
      watchlist: [],
    });
    expect(result).toEqual(['a', 'b']);
  });

  it('merges watchlist even if outside top N', async () => {
    const loader = async () => [
      { appId: 'a', revenue: 100 },
      { appId: 'b', revenue: 50 },
    ];
    const result = await resolveAppsInScope({
      genreId: 'g1',
      topN: 1,
      loadLatestSnapshotApps: loader,
      watchlist: ['z'],
    });
    expect(result).toEqual(['a', 'z']);
  });

  it('sorts unordered loader output by revenue before taking top N', async () => {
    const loader = async () => [
      { appId: 'low', revenue: 10 },
      { appId: 'high', revenue: 1000 },
      { appId: 'mid', revenue: 100 },
    ];
    const result = await resolveAppsInScope({
      genreId: 'g1',
      topN: 2,
      loadLatestSnapshotApps: loader,
      watchlist: [],
    });
    expect(result).toEqual(['high', 'mid']);
  });

  it('dedupes watchlist entries that are already in the top-N', async () => {
    const loader = async () => [
      { appId: 'a', revenue: 100 },
      { appId: 'b', revenue: 50 },
    ];
    const result = await resolveAppsInScope({
      genreId: 'g1',
      topN: 2,
      loadLatestSnapshotApps: loader,
      watchlist: ['a', 'c'],
    });
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns empty result when there are no apps and no watchlist', async () => {
    const loader = vi.fn().mockResolvedValue([]);
    const result = await resolveAppsInScope({
      genreId: 'g1',
      topN: 10,
      loadLatestSnapshotApps: loader,
      watchlist: [],
    });
    expect(result).toEqual([]);
    expect(loader).toHaveBeenCalledOnce();
  });
});
