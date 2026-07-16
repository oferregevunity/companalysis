import { describe, it, expect, vi } from 'vitest';
import {
  buildDiscoveryPrompt,
  parseDiscoveryResponse,
  pickBestMatch,
  discoverCompetitorsWithDeps,
} from './discovery';
import type { SearchedApp } from '../sensorTower/client';
import type { CompetitorRow } from '../sensorTower/competitors';

function hit(appId: string, name: string, publisherName = ''): SearchedApp {
  return {
    appId,
    name,
    publisherName,
    iosAppId: null,
    androidAppId: null,
    iconUrl: null,
    iosCategories: [],
    androidCategories: [],
    gameCategory: null,
  };
}

function categoryRow(appId: string, name: string, revenue: number): CompetitorRow {
  return {
    appId,
    name,
    publisherName: 'Pub',
    iosAppId: null,
    androidAppId: null,
    iconUrl: null,
    revenue,
    downloads: revenue * 10,
  };
}

describe('buildDiscoveryPrompt', () => {
  it('includes the game facts and truncates long descriptions', () => {
    const p = buildDiscoveryPrompt({
      name: 'Hole It 3D',
      publisherName: 'Supersonic',
      subtitle: 'The Growing Hole Adventure!',
      description: 'x'.repeat(5000),
      categories: ['6014', '7003'],
      lastMonthDownloads: 300000,
      lastMonthRevenue: 2000000,
    });
    expect(p).toContain('Hole It 3D');
    expect(p).toContain('Supersonic');
    expect(p).toContain('6014, 7003');
    expect(p).toContain('300000');
    expect(p).not.toContain('x'.repeat(1000));
  });
});

describe('parseDiscoveryResponse', () => {
  it('parses names, publishers, and reasons; drops empty names; caps at 15', () => {
    const raw = JSON.stringify({
      competitors: [
        { name: 'Hole.io', publisher: 'Voodoo', reason: 'same swallow mechanic' },
        { name: '', publisher: 'X', reason: 'dropped' },
        ...Array.from({ length: 20 }, (_, i) => ({ name: `Game ${i}`, publisher: '', reason: '' })),
      ],
    });
    const parsed = parseDiscoveryResponse(raw);
    expect(parsed[0]).toEqual({ name: 'Hole.io', publisher: 'Voodoo', reason: 'same swallow mechanic' });
    expect(parsed).toHaveLength(15);
    expect(parsed.every((c) => c.name.length > 0)).toBe(true);
  });

  it('strips code fences and returns [] on malformed JSON', () => {
    expect(parseDiscoveryResponse('```json\n{"competitors":[{"name":"A"}]}\n```')).toHaveLength(1);
    expect(parseDiscoveryResponse('nope')).toEqual([]);
    expect(parseDiscoveryResponse(JSON.stringify({ competitors: 'bad' }))).toEqual([]);
  });
});

describe('pickBestMatch', () => {
  it('prefers exact normalized title match, breaking ties by publisher', () => {
    const hits = [
      hit('a1', 'Hole.io Clone', 'Someone'),
      hit('a2', 'Hole.io', 'Nobody'),
      hit('a3', 'Hole.io', 'Voodoo'),
    ];
    const best = pickBestMatch({ name: 'Hole.io', publisher: 'Voodoo', reason: '' }, hits);
    expect(best?.appId).toBe('a3');
  });

  it('falls back to containment matches and rejects unrelated hits', () => {
    expect(
      pickBestMatch({ name: 'Attack Hole', publisher: '', reason: '' }, [
        hit('b1', 'Attack Hole: Black Hole Games'),
      ])?.appId,
    ).toBe('b1');
    expect(
      pickBestMatch({ name: 'Attack Hole', publisher: '', reason: '' }, [hit('c1', 'Candy Crush Saga')]),
    ).toBeNull();
  });
});

describe('discoverCompetitorsWithDeps', () => {
  const detail = {
    name: 'Hole It 3D',
    publisherName: 'Supersonic',
    subtitle: null,
    description: 'black hole puzzle',
    categories: ['7012'],
    lastMonthDownloads: null,
    lastMonthRevenue: null,
  };

  it('resolves AI picks in rank order, dedupes, excludes the focus game, and backfills from category', async () => {
    const callGemini = vi.fn().mockResolvedValue(
      JSON.stringify({
        competitors: [
          { name: 'Hole.io', publisher: 'Voodoo', reason: 'same mechanic' },
          { name: 'Attack Hole', publisher: '', reason: 'same theme' },
          { name: 'Invented Game That Does Not Exist', publisher: '', reason: 'hallucinated' },
          { name: 'Hole It 3D', publisher: 'Supersonic', reason: 'is the game itself' },
        ],
      }),
    );
    const searchApps = vi.fn(async (term: string) => {
      if (term === 'Hole.io') return [hit('hole-io', 'Hole.io', 'Voodoo')];
      if (term === 'Attack Hole') return [hit('attack-hole', 'Attack Hole')];
      if (term === 'Hole It 3D') return [hit('focus-id', 'Hole It 3D', 'Supersonic')];
      return [];
    });
    const fetchCategoryTop = vi.fn(async () => [
      categoryRow('hole-io', 'Hole.io', 900),
      categoryRow('cat-1', 'Golf Rival', 800),
      categoryRow('cat-2', 'Ball Blast', 700),
    ]);

    const out = await discoverCompetitorsWithDeps({
      focusAppId: 'focus-id',
      detail,
      category: '7012',
      country: 'US',
      callGemini,
      searchApps,
      fetchCategoryTop,
      targetCount: 4,
    });

    expect(out.map((o) => o.appId)).toEqual(['hole-io', 'attack-hole', 'cat-1', 'cat-2']);
    expect(out[0].source).toBe('ai');
    expect(out[0].reason).toBe('same mechanic');
    // AI row enriched with category revenue when it also ranks there.
    expect(out[0].revenue).toBe(900);
    expect(out[2].source).toBe('category');
  });

  it('falls back to pure category list when Gemini fails', async () => {
    const out = await discoverCompetitorsWithDeps({
      focusAppId: 'focus-id',
      detail,
      category: '7012',
      country: 'US',
      callGemini: vi.fn().mockRejectedValue(new Error('vertex down')),
      searchApps: vi.fn(),
      fetchCategoryTop: async () => [categoryRow('cat-1', 'Golf Rival', 800)],
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('category');
  });

  it('returns AI-only list when no category is available', async () => {
    const out = await discoverCompetitorsWithDeps({
      focusAppId: 'focus-id',
      detail,
      category: null,
      country: 'US',
      callGemini: vi.fn().mockResolvedValue(JSON.stringify({ competitors: [{ name: 'Hole.io', publisher: '', reason: '' }] })),
      searchApps: async () => [hit('hole-io', 'Hole.io')],
      fetchCategoryTop: vi.fn(),
    });
    expect(out.map((o) => o.appId)).toEqual(['hole-io']);
  });
});
