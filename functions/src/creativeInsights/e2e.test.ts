/**
 * End-to-end style integration tests for the creatives pipeline using **dependency
 * injection only** (no Firebase emulator, no `@firebase/rules-unit-testing`). This
 * matches the rest of the suite: exercise the exported `-WithDeps` entry points with
 * in-memory stubs.
 *
 * **Approach (two tests, per plan recommendation):**
 * - **Test A — fetch → score:** Run `fetchCreativesForGenreWithDeps` with a mocked
 *   Sensor Tower fetcher, capture `writeSnapshot` as our fake `creativeSnapshots` /
 *   `creativeLatest` layer, then run `scoreCreativesForGenreWithDeps` with
 *   `loadCreatives` returning those docs. Asserts dedup counts, merged networks on
 *   stock rows, distinct `${appId}__PH-STOCK` keys, and score row parity.
 * - **Test B — insights:** Seed `CreativeScoreRow`s directly, run
 *   `generateAndStoreCreativeInsightsWithDeps` with stubbed Gemini — validates the
 *   insights doc shape without re-scoring.
 *
 * **Networks:** `fetchCreativesForGenreWithDeps` iterates `TRACKED_NETWORKS` (9).
 * The mock returns `[]` for networks outside `Instagram`, `Facebook`, and `TikTok`
 * so counts stay deterministic: **1 stock + 3 uniques = 4 creatives per app**.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchCreativesForGenreWithDeps,
  creativeDocId,
  weekKeyFromStart,
  type StoredCreative,
} from '../adIntel/fetchCreativesForGenre';
import type { RawCreative, QueryableAdNetwork } from '../adIntel/types';
import { TRACKED_NETWORKS } from '../adIntel/types';
import type { GenreDoc } from '../sensorTower/fetchTopApps';
import { scoreCreativesForGenreWithDeps, type CreativeScoreRow } from './scoringPipeline';
import { generateAndStoreCreativeInsightsWithDeps } from './pipeline';

const E2E_NETWORKS: readonly QueryableAdNetwork[] = ['Instagram', 'Facebook', 'TikTok'] as const;

const WEEK_START = '2026-04-13';
const WEEK_END = '2026-04-19';
const GENRE_ID = 'g-e2e';
const WEEK = weekKeyFromStart(WEEK_START);

/** Final merged scope: top-3 by revenue + one watchlist app (resolveApps is mocked). */
const APPS_IN_SCOPE = ['app-1', 'app-2', 'app-3', 'app-4'] as const;

const APP_METADATA = [
  { appId: 'app-1', name: 'App One', publisherName: 'Pub', iosAppId: null, androidAppId: null },
  { appId: 'app-2', name: 'App Two', publisherName: 'Pub', iosAppId: null, androidAppId: null },
  { appId: 'app-3', name: 'App Three', publisherName: 'Pub', iosAppId: null, androidAppId: null },
  { appId: 'app-4', name: 'Watch App', publisherName: 'Pub', iosAppId: null, androidAppId: null },
] as const;

function fakeCreativesFor(appId: string, network: QueryableAdNetwork): RawCreative[] {
  if (!E2E_NETWORKS.includes(network)) return [];
  return [
    {
      id: `${appId}-${network}-stock`,
      phashionGroup: 'PH-STOCK',
      appId,
      network,
      country: 'US',
      format: 'video',
      rawAdType: 'video',
      firstSeen: '2026-04-10',
      lastSeen: '2026-04-20',
      durationDays: 10,
      share: 0.3,
      mediaUrl: `https://e/${appId}-${network}.mp4`,
      previewUrl: null,
      thumbnailUrl: null,
      htmlUrl: null,
      videoDurationSec: 30,
      width: 1080,
      height: 1920,
      title: null,
      message: null,
      buttonText: null,
      variantCount: 1,
      adFormats: ['video'],
      breakdown: [],
    },
    {
      id: `${appId}-${network}-unique`,
      phashionGroup: null,
      appId,
      network,
      country: 'US',
      format: 'video',
      rawAdType: 'video',
      firstSeen: '2026-04-15',
      lastSeen: '2026-04-20',
      durationDays: 5,
      share: 0.15,
      mediaUrl: null,
      previewUrl: null,
      thumbnailUrl: null,
      htmlUrl: null,
      videoDurationSec: null,
      width: null,
      height: null,
      title: null,
      message: null,
      buttonText: null,
      variantCount: 1,
      adFormats: ['video'],
      breakdown: [],
    },
  ];
}

describe('creatives pipeline e2e (DI)', () => {
  it('Test A: fetch → score with cross-network dedup and per-app doc ids', async () => {
    const resolveApps = vi.fn().mockResolvedValue([...APPS_IN_SCOPE]);
    const fetchCreatives = vi.fn().mockImplementation(async (p: { appId: string; network: QueryableAdNetwork }) =>
      fakeCreativesFor(p.appId, p.network),
    );
    const snapshotWrites: StoredCreative[] = [];
    const writeSnapshot = vi.fn(async (docs: StoredCreative[]) => {
      snapshotWrites.length = 0;
      snapshotWrites.push(...docs);
    });
    const upsertAppNames = vi.fn().mockResolvedValue(undefined);

    const fetchResult = await fetchCreativesForGenreWithDeps({
      genre: { id: GENRE_ID, country: 'US' } as GenreDoc,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
      authToken: 'tok',
      resolveApps,
      fetchCreatives,
      writeSnapshot,
      upsertAppNames,
      appMetadata: [...APP_METADATA],
      watchlist: ['app-4'],
    });

    expect(fetchResult.success).toBe(true);
    expect(fetchResult.partialErrors).toEqual([]);
    expect(resolveApps).toHaveBeenCalledWith(GENRE_ID, 25, ['app-4']);

    const expectedCalls = APPS_IN_SCOPE.length * TRACKED_NETWORKS.length;
    expect(fetchCreatives).toHaveBeenCalledTimes(expectedCalls);

    expect(fetchResult.creativeCount).toBe(16);
    expect(snapshotWrites).toHaveLength(16);

    for (const appId of APPS_IN_SCOPE) {
      const forApp = snapshotWrites.filter(d => d.appId === appId);
      expect(forApp).toHaveLength(4);
      const stock = forApp.find(d => d.phashionGroup === 'PH-STOCK');
      expect(stock).toBeDefined();
      expect(stock!.networks).toEqual([...E2E_NETWORKS].sort());
      expect(stock!.creativeKey).toBe('PH-STOCK');
      const stockId = creativeDocId(appId, 'PH-STOCK');
      expect(stockId).toBe(`${appId}__PH-STOCK`);
    }

    const stockKeys = new Set(
      snapshotWrites.filter(d => d.phashionGroup === 'PH-STOCK').map(d => creativeDocId(d.appId, d.creativeKey)),
    );
    expect(stockKeys.size).toBe(4);
    expect(stockKeys).toEqual(new Set(APPS_IN_SCOPE.map(a => `${a}__PH-STOCK`)));

    const scoreRows: CreativeScoreRow[] = [];
    const scoreResult = await scoreCreativesForGenreWithDeps({
      genreId: GENRE_ID,
      week: WEEK,
      loadCreatives: async (genreId, week) => {
        expect(genreId).toBe(GENRE_ID);
        expect(week).toBe(WEEK);
        return snapshotWrites;
      },
      writeScores: async rows => {
        scoreRows.push(...rows);
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(scoreResult.scored).toBe(16);
    expect(scoreRows).toHaveLength(16);

    const byDoc = new Map(snapshotWrites.map(d => [creativeDocId(d.appId, d.creativeKey), d]));
    for (const row of scoreRows) {
      expect(byDoc.has(row.docId)).toBe(true);
      expect(row.genreId).toBe(GENRE_ID);
      expect(row.week).toBe(WEEK);
    }
  });

  it('Test B: insights generation with seeded scores and stubbed Gemini', async () => {
    const scores: CreativeScoreRow[] = [
      {
        docId: 'app-1__PH-STOCK',
        creativeKey: 'PH-STOCK',
        appId: 'app-1',
        genreId: GENRE_ID,
        week: WEEK,
        score: 85,
        subScores: { longevity: 20, networkBreadth: 20, impressionMomentum: 0, freshnessAdjustedPersistence: 20 },
        computedAt: '2026-04-21T00:00:00.000Z',
      },
      {
        docId: 'app-2__PH-STOCK',
        creativeKey: 'PH-STOCK',
        appId: 'app-2',
        genreId: GENRE_ID,
        week: WEEK,
        score: 55,
        subScores: { longevity: 15, networkBreadth: 15, impressionMomentum: 0, freshnessAdjustedPersistence: 10 },
        computedAt: '2026-04-21T00:00:00.000Z',
      },
    ];

    const creatives = new Map<string, StoredCreative>([
      [
        'app-1__PH-STOCK',
        {
          creativeKey: 'PH-STOCK',
          sampleId: 's',
          phashionGroup: 'PH-STOCK',
          appId: 'app-1',
          networks: ['Instagram', 'Facebook', 'TikTok'],
          format: 'video',
          country: 'US',
          firstSeen: '2026-04-10',
          lastSeen: '2026-04-20',
          durationDays: 10,
          maxShare: 0.3,
          mediaUrl: null,
          previewUrl: null,
          thumbnailUrl: null,
          htmlUrl: null,
          videoDurationSec: null,
          width: null,
          height: null,
          title: null,
          message: null,
          buttonText: null,
          variantCount: 1,
          adFormats: [],
          breakdown: [],
          genreId: GENRE_ID,
          capturedWeek: WEEK,
        },
      ],
    ]);

    const appMeta = new Map<string, { name: string; publisherName: string }>([
      ['app-1', { name: 'App One', publisherName: 'Pub' }],
      ['app-2', { name: 'App Two', publisherName: 'Pub' }],
    ]);

    const mockGemini = vi.fn().mockResolvedValue({
      summary: 'Test summary',
      winners: [{ creativeId: 'app-1__PH-STOCK', explanation: 'Top performer' }],
      emergingConcepts: [
        { title: 'Stock creative', description: 'Shared asset', exampleCreativeIds: ['app-1__PH-STOCK'] },
      ],
      watchList: [],
    });

    const writes: unknown[] = [];
    const result = await generateAndStoreCreativeInsightsWithDeps({
      genreId: GENRE_ID,
      week: WEEK,
      genreName: 'Match 3',
      loadScores: async () => scores,
      loadCreatives: async ids => {
        const m = new Map<string, StoredCreative>();
        for (const id of ids) {
          const c = creatives.get(id);
          if (c) m.set(id, c);
        }
        return m;
      },
      loadAppMeta: async () => appMeta,
      callGemini: mockGemini,
      write: async doc => {
        writes.push(doc);
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.winners).toBeGreaterThanOrEqual(1);
    expect(writes).toHaveLength(1);
    const doc = writes[0] as { summary: string; winners: { creativeId: string }[] };
    expect(doc.summary).toBe('Test summary');
    expect(doc.winners.length).toBeGreaterThanOrEqual(1);
    expect(doc.winners[0].creativeId).toBe('app-1__PH-STOCK');
  });
});
