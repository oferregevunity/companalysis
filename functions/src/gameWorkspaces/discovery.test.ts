import { describe, it, expect, vi } from 'vitest';
import {
  buildDiscoveryPrompt,
  parseDiscoveryResponse,
  pickBestMatch,
  discoverCompetitorsWithDeps,
} from './discovery';
import type { SearchedApp } from '../sensorTower/client';

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

  it('resolves AI picks in rank order, dedupes, excludes the focus game, drops hallucinated titles, and injects no category rows', async () => {
    const callGemini = vi.fn().mockResolvedValue(
      JSON.stringify({
        competitors: [
          { name: 'Hole.io', publisher: 'Voodoo', reason: 'same mechanic' },
          { name: 'Attack Hole', publisher: '', reason: 'same theme' },
          { name: 'Hole.io', publisher: 'Voodoo', reason: 'duplicate pick' },
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

    const out = await discoverCompetitorsWithDeps({
      focusAppId: 'focus-id',
      detail,
      callGemini,
      searchApps,
    });

    // Only real, AI-matched competitors — deduped, focus + hallucinated dropped.
    expect(out.map((o) => o.appId)).toEqual(['hole-io', 'attack-hole']);
    expect(out.every((o) => o.source === 'ai')).toBe(true);
    expect(out[0].reason).toBe('same mechanic');
    // No category enrichment: AI rows carry no revenue.
    expect(out[0].revenue).toBeNull();
  });

  it('returns an empty list when Gemini fails', async () => {
    const out = await discoverCompetitorsWithDeps({
      focusAppId: 'focus-id',
      detail,
      callGemini: vi.fn().mockRejectedValue(new Error('vertex down')),
      searchApps: vi.fn(),
    });
    expect(out).toEqual([]);
  });
});
