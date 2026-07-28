import { describe, it, expect, vi } from 'vitest';
import { TRACKED_NETWORKS } from './types';
import {
  fetchCreativesForGenreWithDeps,
  type StoredCreative,
} from './fetchCreativesForGenre';
import type { RawCreative, QueryableAdNetwork } from './types';

function makeRaw(overrides: Partial<RawCreative>): RawCreative {
  return {
    id: 'id-' + Math.random(),
    phashionGroup: 'ph-1',
    appId: 'app-1',
    network: 'Instagram',
    country: 'US',
    format: 'video',
    rawAdType: 'video',
    firstSeen: '2026-04-10',
    lastSeen: '2026-04-20',
    durationDays: 10,
    share: 0.3,
    mediaUrl: 'https://x/m',
    previewUrl: 'https://x/p',
    thumbnailUrl: 'https://x/t',
    htmlUrl: null,
    videoDurationSec: 15,
    width: 1080,
    height: 1920,
    title: null,
    message: null,
    buttonText: null,
    variantCount: 1,
    adFormats: ['other'],
    breakdown: [],
    ...overrides,
  };
}

describe('fetchCreativesForGenreWithDeps', () => {
  it('calls fetchCreatives once per (app × tracked network)', async () => {
    const resolveApps = vi.fn().mockResolvedValue(['app-1']);
    const fetchCreatives = vi.fn().mockResolvedValue([]);
    const writeSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [
        {
          appId: 'app-1',
          name: 'App One',
          publisherName: null,
          iosAppId: null,
          androidAppId: null,
        },
      ],
      watchlist: [],
    });

    expect(fetchCreatives).toHaveBeenCalledTimes(TRACKED_NETWORKS.length);
    for (const network of TRACKED_NETWORKS) {
      expect(fetchCreatives).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'app-1',
          network,
          country: 'US',
        }),
      );
    }
  });

  it('dedups by phashionGroup across networks and unions network list', async () => {
    const resolveApps = vi.fn().mockResolvedValue(['app-1']);
    const fetchCreatives = vi.fn().mockImplementation(async (p: { network: QueryableAdNetwork }) => {
      if (p.network === 'Instagram') {
        return [makeRaw({ network: 'Instagram', share: 0.3 })];
      }
      if (p.network === 'Facebook') {
        return [makeRaw({ network: 'Facebook', share: 0.5 })];
      }
      return [];
    });
    const writeSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    const result = await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [{ appId: 'app-1', name: 'App One', publisherName: 'Pub', iosAppId: null, androidAppId: null }],
      watchlist: [],
    });

    expect(result.creativeCount).toBe(1);
    expect(writeSnapshot).toHaveBeenCalledOnce();
    const docs: StoredCreative[] = writeSnapshot.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect([...docs[0].networks].sort()).toEqual(['Facebook', 'Instagram']);
    expect(docs[0].maxShare).toBeCloseTo(0.5);
    expect(upsertAppNames).toHaveBeenCalledOnce();
    expect(upsertAppNames.mock.calls[0][0]).toHaveLength(1);
  });

  it('does not collapse same phashionGroup across different apps', async () => {
    const resolveApps = vi.fn().mockResolvedValue(['app-1', 'app-2']);
    const fetchCreatives = vi.fn().mockImplementation(async (p: { appId: string; network: QueryableAdNetwork }) => {
      if (p.network !== 'Instagram') return [];
      return [makeRaw({ appId: p.appId, phashionGroup: 'shared-stock' })];
    });
    const writeSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    const result = await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [
        { appId: 'app-1', name: 'A1', publisherName: null, iosAppId: null, androidAppId: null },
        { appId: 'app-2', name: 'A2', publisherName: null, iosAppId: null, androidAppId: null },
      ],
      watchlist: [],
    });

    expect(result.creativeCount).toBe(2);
    const docs: StoredCreative[] = writeSnapshot.mock.calls[0][0];
    expect(docs.map(d => d.appId).sort()).toEqual(['app-1', 'app-2']);
    expect(new Set(docs.map(d => d.creativeKey))).toEqual(new Set(['shared-stock']));
  });

  it('captures per-(app, network) errors in partialErrors without aborting', async () => {
    const resolveApps = vi.fn().mockResolvedValue(['app-1']);
    const fetchCreatives = vi.fn().mockImplementation(async (p: { network: QueryableAdNetwork }) => {
      if (p.network === 'TikTok') throw new Error('429');
      return [makeRaw({ network: p.network })];
    });
    const writeSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    const result = await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [{ appId: 'app-1', name: 'App One', publisherName: null, iosAppId: null, androidAppId: null }],
      watchlist: [],
    });

    expect(result.success).toBe(false);
    expect(result.partialErrors.length).toBe(1);
    expect(result.partialErrors[0]).toMatch(/app=app-1.*TikTok.*429/);
    expect(writeSnapshot).toHaveBeenCalledOnce();
  });

  it('returns empty result when no apps in scope', async () => {
    const resolveApps = vi.fn().mockResolvedValue([]);
    const fetchCreatives = vi.fn();
    const writeSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    const result = await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [],
      watchlist: [],
    });

    expect(result.creativeCount).toBe(0);
    expect(fetchCreatives).not.toHaveBeenCalled();
    expect(writeSnapshot).toHaveBeenCalledOnce();
    expect(upsertAppNames).not.toHaveBeenCalled();
  });

  it('writeSnapshot receives exactly one call with final docs array', async () => {
    const resolveApps = vi.fn().mockResolvedValue(['app-1']);
    const fetchCreatives = vi.fn().mockResolvedValue([makeRaw({ network: 'Instagram' })]);
    const writeSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    await fetchCreativesForGenreWithDeps({
      genre: { id: 'g1', country: 'US' } as any,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [{ appId: 'app-1', name: 'A', publisherName: null, iosAppId: null, androidAppId: null }],
      watchlist: [],
    });

    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(Array.isArray(writeSnapshot.mock.calls[0][0])).toBe(true);
  });
});
