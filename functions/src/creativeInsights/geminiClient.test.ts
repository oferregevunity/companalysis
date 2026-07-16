// functions/src/creativeInsights/geminiClient.test.ts
import { describe, it, expect } from 'vitest';
import { buildCreativePrompt, parseCreativeResponse, HOOK_TYPES } from './geminiClient';

describe('buildCreativePrompt', () => {
  it('includes genre, week, each winner id, networks, and sub-scores', () => {
    const p = buildCreativePrompt({
      genreName: 'Match 3',
      week: '2026-W16',
      winners: [
        {
          creativeId: 'app-1__ph-1',
          appId: 'app-1',
          appName: 'Candy',
          publisherName: 'King',
          networks: ['Facebook', 'TikTok'],
          format: 'video',
          durationDays: 19,
          firstSeen: '2026-04-01',
          score: 72,
          subScores: {
            longevity: 15,
            networkBreadth: 8,
            impressionMomentum: 20,
            freshnessAdjustedPersistence: 25,
          },
        },
      ],
      conceptCandidates: [],
      watchCandidates: [],
    });
    expect(p).toContain('Match 3');
    expect(p).toContain('2026-W16');
    expect(p).toContain('Facebook');
    expect(p).toContain('TikTok');
    expect(p).toContain('72');
    expect(p).toContain('app-1__ph-1');
  });

  it('includes the hook taxonomy and ad text when present', () => {
    const p = buildCreativePrompt({
      genreName: 'Puzzle',
      week: '2026-W16',
      winners: [
        {
          creativeId: 'a__c',
          appId: 'a',
          appName: 'A',
          publisherName: 'P',
          networks: ['TikTok'],
          format: 'video',
          durationDays: 5,
          firstSeen: '2026-04-01',
          score: 70,
          subScores: { longevity: 10, networkBreadth: 5, impressionMomentum: 10, freshnessAdjustedPersistence: 10 },
          title: 'Can you beat level 3?',
          message: 'Only 2% pass this',
        },
      ],
      conceptCandidates: [],
      watchCandidates: [],
    });
    for (const h of HOOK_TYPES) expect(p).toContain(h);
    expect(p).toContain('Can you beat level 3?');
    expect(p).toContain('Only 2% pass this');
    expect(p).toContain('creativeTags');
  });

  it('lists concept candidates and watch candidates separately', () => {
    const p = buildCreativePrompt({
      genreName: 'Casino',
      week: '2026-W16',
      winners: [],
      conceptCandidates: [{ creativeId: 'c-concept', appId: 'a2', appName: 'Slots', format: 'image', networks: ['Instagram'], score: 55 }],
      watchCandidates: [{ creativeId: 'c-watch', appId: 'a3', appName: 'Bingo', format: 'video', networks: ['Youtube'], score: 52 }],
    });
    expect(p).toContain('c-concept');
    expect(p).toContain('c-watch');
    expect(p).toContain('Slots');
    expect(p).toContain('Bingo');
  });
});

describe('parseCreativeResponse', () => {
  it('extracts summary, winners, emergingConcepts, watchList from valid JSON', () => {
    const parsed = parseCreativeResponse(
      JSON.stringify({
        summary: 's',
        winners: [{ creativeId: 'c1', explanation: 'e' }],
        emergingConcepts: [{ title: 't', description: 'd', exampleCreativeIds: ['c1'] }],
        watchList: [{ creativeId: 'c2', reason: 'r' }],
      }),
    );
    expect(parsed.summary).toBe('s');
    expect(parsed.winners[0].creativeId).toBe('c1');
    expect(parsed.winners[0].explanation).toBe('e');
    expect(parsed.emergingConcepts[0].title).toBe('t');
    expect(parsed.emergingConcepts[0].exampleCreativeIds).toEqual(['c1']);
    expect(parsed.watchList[0].creativeId).toBe('c2');
    expect(parsed.watchList[0].reason).toBe('r');
  });

  it('strips ```json code fences', () => {
    const raw = '```json\n' + JSON.stringify({ summary: 'x', winners: [], emergingConcepts: [], watchList: [] }) + '\n```';
    const parsed = parseCreativeResponse(raw);
    expect(parsed.summary).toBe('x');
  });

  it('returns empty structure for malformed JSON', () => {
    const parsed = parseCreativeResponse('not json at all');
    expect(parsed.summary).toBe('');
    expect(parsed.winners).toEqual([]);
    expect(parsed.emergingConcepts).toEqual([]);
    expect(parsed.watchList).toEqual([]);
  });

  it('coerces non-array fields to empty arrays', () => {
    const parsed = parseCreativeResponse(JSON.stringify({ summary: 'x', winners: 'bad', emergingConcepts: null, watchList: 5 }));
    expect(parsed.winners).toEqual([]);
    expect(parsed.emergingConcepts).toEqual([]);
    expect(parsed.watchList).toEqual([]);
    expect(parsed.creativeTags).toEqual([]);
  });

  it('parses creativeTags, coercing unknown hook types to Other and capping themes', () => {
    const parsed = parseCreativeResponse(
      JSON.stringify({
        summary: '',
        winners: [],
        emergingConcepts: [],
        watchList: [],
        creativeTags: [
          { creativeId: 'c1', hookType: 'Fail & Frustration', themes: ['rage bait', 'level 10'] },
          { creativeId: 'c2', hookType: 'Something Made Up', themes: ['a', 'b', 'c', 'd', 'e'] },
          { creativeId: '', hookType: 'Other', themes: [] },
          { creativeId: 'c3', hookType: 'Satisfying / ASMR', themes: 'not-an-array' },
        ],
      }),
    );
    expect(parsed.creativeTags).toHaveLength(3);
    expect(parsed.creativeTags[0]).toEqual({ creativeId: 'c1', hookType: 'Fail & Frustration', themes: ['rage bait', 'level 10'] });
    expect(parsed.creativeTags[1].hookType).toBe('Other');
    expect(parsed.creativeTags[1].themes).toHaveLength(4);
    expect(parsed.creativeTags[2]).toEqual({ creativeId: 'c3', hookType: 'Satisfying / ASMR', themes: [] });
  });
});
