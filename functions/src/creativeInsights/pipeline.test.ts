import { describe, it, expect, vi } from 'vitest';
import { generateAndStoreCreativeInsightsWithDeps } from './pipeline';
import type { CreativeScoreRow } from './scoringPipeline';
import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';

function score(docId: string, s: number): CreativeScoreRow {
  const [appId, creativeKey] = docId.split('__');
  return {
    docId,
    creativeKey,
    appId,
    genreId: 'g1',
    week: '2026-W16',
    score: s,
    subScores: { longevity: 10, networkBreadth: 5, impressionMomentum: 0, freshnessAdjustedPersistence: 10 },
    computedAt: '2026-04-21T00:00:00.000Z',
  };
}

function creative(docId: string): StoredCreative {
  const [appId, creativeKey] = docId.split('__');
  return {
    creativeKey,
    sampleId: 's',
    phashionGroup: null,
    appId,
    networks: ['Instagram'],
    format: 'video',
    country: 'US',
    firstSeen: '2026-04-01',
    lastSeen: '2026-04-20',
    durationDays: 19,
    maxShare: 0.2,
    mediaUrl: null,
    previewUrl: null,
    thumbnailUrl: null,
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
  };
}

describe('generateAndStoreCreativeInsightsWithDeps', () => {
  it('selects winners (score>=60, top-10), concepts (next 20), watch (50-59, top 5)', async () => {
    // Construct 35 scores: 12 at 70-81 (only top 10 should win), 20 at 55-74 range, 3 at 50-59
    const scores: CreativeScoreRow[] = [];
    for (let i = 0; i < 12; i++) scores.push(score(`app-${i}__ck-${i}`, 70 + i)); // 12 winners pool
    for (let i = 12; i < 32; i++) scores.push(score(`app-${i}__ck-${i}`, 40 + i)); // concept candidates 52-71
    for (let i = 32; i < 35; i++) scores.push(score(`app-${i}__ck-${i}`, 50 + (i - 32) * 3)); // 50, 53, 56 → watch
    scores.push(score('app-x__ck-x', 10)); // dud, never used

    const creatives = new Map(scores.map(s => [s.docId, creative(s.docId)]));
    const appMeta = new Map(scores.map(s => [s.appId, { name: `App ${s.appId}`, publisherName: `Pub ${s.appId}` }]));

    const topWinners = [...scores]
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
      .filter(x => x.s.score >= 60)
      .slice(0, 10)
      .map(x => x.s);

    const callGemini = vi.fn().mockResolvedValue({
      summary: 'top ten winners dominated Instagram video this week',
      winners: topWinners.map(s => ({ creativeId: s.docId, explanation: `why ${s.docId} wins` })),
      emergingConcepts: [{ title: 'merge hooks', description: 'd', exampleCreativeIds: ['app-12__ck-12'] }],
      watchList: [{ creativeId: 'app-34__ck-34', reason: 'climbing' }],
    });
    const writes: any[] = [];

    const result = await generateAndStoreCreativeInsightsWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      genreName: 'Match 3',
      loadScores: async () => scores,
      loadCreatives: async () => creatives,
      loadAppMeta: async () => appMeta,
      callGemini,
      write: async d => {
        writes.push(d);
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.winners).toBe(10);
    expect(callGemini).toHaveBeenCalledOnce();
    const [promptInput] = callGemini.mock.calls[0];
    expect(promptInput.genreName).toBe('Match 3');
    expect(promptInput.winners).toHaveLength(10); // score>=60, top-10
    expect(promptInput.conceptCandidates.length).toBeLessThanOrEqual(20);
    expect(promptInput.watchCandidates.length).toBeGreaterThan(0);
    expect(promptInput.watchCandidates.length).toBeLessThanOrEqual(5);
    for (const w of promptInput.watchCandidates) {
      const row = scores.find(s => s.docId === w.creativeId)!;
      expect(row.score).toBeGreaterThanOrEqual(50);
      expect(row.score).toBeLessThan(60);
    }

    expect(writes).toHaveLength(1);
    const doc = writes[0];
    expect(doc.genreId).toBe('g1');
    expect(doc.week).toBe('2026-W16');
    expect(doc.summary).toContain('top ten winners');
    expect(doc.winners).toHaveLength(10);
    expect(doc.winners[0].rank).toBe(1);
    expect(doc.winners[0].explanation).toContain('why');
    expect(doc.winners[0].appName).toMatch(/^App app-/);
    expect(doc.winners[0].subScores).toBeDefined();
  });

  it('falls back to "Unknown app" when appNames is missing', async () => {
    const scores = [score('app-1__ck-1', 80)];
    const creatives = new Map(scores.map(s => [s.docId, creative(s.docId)]));
    const callGemini = vi.fn().mockResolvedValue({
      summary: '',
      winners: [{ creativeId: 'app-1__ck-1', explanation: 'e' }],
      emergingConcepts: [],
      watchList: [],
    });
    const writes: any[] = [];
    await generateAndStoreCreativeInsightsWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      genreName: 'G',
      loadScores: async () => scores,
      loadCreatives: async () => creatives,
      loadAppMeta: async () => new Map(), // empty
      callGemini,
      write: async d => {
        writes.push(d);
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(writes[0].winners[0].appName).toBe('Unknown app');
  });

  it('writes a degraded doc (winners:[], geminiError set) when Gemini fails', async () => {
    const scores = [score('a__c', 75)];
    const creatives = new Map(scores.map(s => [s.docId, creative(s.docId)]));
    const appMeta = new Map([['a', { name: 'A', publisherName: 'P' }]]);
    const writes: any[] = [];
    const result = await generateAndStoreCreativeInsightsWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      genreName: 'G',
      loadScores: async () => scores,
      loadCreatives: async () => creatives,
      loadAppMeta: async () => appMeta,
      callGemini: async () => ({
        summary: '',
        winners: [],
        emergingConcepts: [],
        watchList: [],
        geminiError: 'timeout',
      }),
      write: async d => {
        writes.push(d);
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.geminiError).toBe('timeout');
    expect(writes).toHaveLength(1);
    expect(writes[0].geminiError).toBe('timeout');
    expect(writes[0].winners).toEqual([]);
    expect(writes[0].summary).toBe('');
  });

  it('writes an empty insight doc when there are no scores', async () => {
    const writes: any[] = [];
    const callGemini = vi.fn();
    const result = await generateAndStoreCreativeInsightsWithDeps({
      genreId: 'g1',
      week: '2026-W16',
      genreName: 'G',
      loadScores: async () => [],
      loadCreatives: async () => new Map(),
      loadAppMeta: async () => new Map(),
      callGemini,
      write: async d => {
        writes.push(d);
      },
      now: new Date('2026-04-21T00:00:00Z'),
    });
    expect(callGemini).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.winners).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].winners).toEqual([]);
    expect(writes[0].summary).toBe('');
  });
});
