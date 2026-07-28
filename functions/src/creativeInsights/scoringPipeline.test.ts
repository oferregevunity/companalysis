import { describe, it, expect, vi } from 'vitest';
import { scoreCreativesForGenreWithDeps, type CreativeScoreRow } from './scoringPipeline';
import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';

function makeStored(overrides: Partial<StoredCreative> = {}): StoredCreative {
  return {
    creativeKey: 'ck-1',
    sampleId: 's-1',
    phashionGroup: 'ph-1',
    appId: 'app-1',
    networks: ['Instagram'],
    format: 'video',
    country: 'US',
    firstSeen: '2026-04-01',
    lastSeen: '2026-04-20',
    durationDays: 19,
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
    genreId: 'g1',
    capturedWeek: '2026-W16',
    ...overrides,
  };
}

describe('scoreCreativesForGenreWithDeps', () => {
  it('scores all loaded creatives and writes rows with computed composite + sub-scores', async () => {
    const loaded = [makeStored({ creativeKey: 'ck-1' }), makeStored({ creativeKey: 'ck-2', durationDays: 45, networks: ['Instagram', 'Facebook', 'TikTok'] })];
    const loadCreatives = vi.fn().mockResolvedValue(loaded);
    const writeScores = vi.fn().mockResolvedValue(undefined);

    const result = await scoreCreativesForGenreWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      loadCreatives,
      writeScores,
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(result.scored).toBe(2);
    expect(loadCreatives).toHaveBeenCalledWith('g1', '2026-W16');
    expect(writeScores).toHaveBeenCalledOnce();
    const rows: CreativeScoreRow[] = writeScores.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
      expect(row.subScores.longevity).toBeGreaterThanOrEqual(0);
      expect(row.subScores.networkBreadth).toBeGreaterThanOrEqual(0);
      expect(row.subScores.impressionMomentum).toBeGreaterThanOrEqual(0);
      expect(row.subScores.freshnessAdjustedPersistence).toBeGreaterThanOrEqual(0);
      expect(row.appId).toBe('app-1');
      expect(row.creativeKey).toMatch(/^ck-/);
      expect(row.docId).toBe(`app-1__${row.creativeKey}`);
    }
  });

  it('higher durationDays produces a higher composite score than a 1-day creative', async () => {
    const loaded = [
      makeStored({ creativeKey: 'short', durationDays: 1, firstSeen: '2026-04-20' }),
      makeStored({ creativeKey: 'long', durationDays: 45, firstSeen: '2026-03-07' }),
    ];
    const writes: CreativeScoreRow[] = [];
    await scoreCreativesForGenreWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      loadCreatives: async () => loaded,
      writeScores: async rows => { writes.push(...rows); },
      now: new Date('2026-04-21T00:00:00Z'),
    });
    const short = writes.find(r => r.creativeKey === 'short')!;
    const long = writes.find(r => r.creativeKey === 'long')!;
    expect(long.score).toBeGreaterThan(short.score);
  });

  it('calls writeScores exactly once with empty array when no creatives', async () => {
    const loadCreatives = vi.fn().mockResolvedValue([]);
    const writeScores = vi.fn().mockResolvedValue(undefined);
    const result = await scoreCreativesForGenreWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      loadCreatives,
      writeScores,
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(result.scored).toBe(0);
    expect(writeScores).toHaveBeenCalledWith([]);
  });
});
