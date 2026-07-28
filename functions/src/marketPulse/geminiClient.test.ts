import { describe, it, expect } from 'vitest';
import { buildMarketPulsePrompt, parseMarketPulseResponse } from './geminiClient';
import type { RisingCluster } from './aggregate';

function cluster(kind: 'hook' | 'theme', label: string, over: Partial<RisingCluster> = {}): RisingCluster {
  return {
    kind,
    label,
    count: 10,
    prevCount: 4,
    wowGrowthPct: 150,
    isNew: false,
    exampleCreativeIds: [`${label}__1`],
    genresSeenIn: ['puzzle'],
    ...over,
  };
}

const clusters: RisingCluster[] = [
  cluster('hook', 'Fail & Frustration'),
  cluster('theme', 'home renovation'),
];

describe('buildMarketPulsePrompt', () => {
  it('numbers the clusters and asks for a numeric index', () => {
    const prompt = buildMarketPulsePrompt(clusters, '2026-W30');
    expect(prompt).toContain('0. [hook] "Fail & Frustration"');
    expect(prompt).toContain('1. [theme] "home renovation"');
    expect(prompt).toContain('"index"');
  });
});

describe('parseMarketPulseResponse', () => {
  it('matches by numeric index and applies title + description', () => {
    const raw = JSON.stringify({
      concepts: [
        { index: 0, title: 'Rage Quit Bait', description: 'Lean into near-miss failures.' },
        { index: 1, title: 'Fixer-Upper', description: 'Before/after home transforms.' },
      ],
    });
    const out = parseMarketPulseResponse(raw, clusters);
    expect(out[0]).toMatchObject({ label: 'Fail & Frustration', title: 'Rage Quit Bait', description: 'Lean into near-miss failures.' });
    expect(out[1]).toMatchObject({ label: 'home renovation', title: 'Fixer-Upper', description: 'Before/after home transforms.' });
  });

  it('accepts a string index', () => {
    const raw = JSON.stringify({ concepts: [{ index: '1', title: 'T', description: 'D' }] });
    const out = parseMarketPulseResponse(raw, clusters);
    expect(out[1]).toMatchObject({ title: 'T', description: 'D' });
    expect(out[0].description).toBe(''); // untouched
  });

  it('falls back to a case-insensitive label match when index is absent', () => {
    const raw = JSON.stringify({
      concepts: [{ label: 'fail & frustration', title: 'Rage Bait', description: 'desc' }],
    });
    const out = parseMarketPulseResponse(raw, clusters);
    expect(out[0]).toMatchObject({ title: 'Rage Bait', description: 'desc' });
  });

  it('ignores out-of-range indices with no label', () => {
    const raw = JSON.stringify({ concepts: [{ index: 9, title: 'X', description: 'Y' }] });
    const out = parseMarketPulseResponse(raw, clusters);
    expect(out).toEqual(parseMarketPulseResponse('nonsense', clusters)); // == base
  });

  it('keeps the base label as title when Gemini omits one', () => {
    const raw = JSON.stringify({ concepts: [{ index: 0, description: 'just a description' }] });
    const out = parseMarketPulseResponse(raw, clusters);
    expect(out[0].title).toBe('Fail & Frustration');
    expect(out[0].description).toBe('just a description');
  });

  it('strips markdown fences before parsing', () => {
    const raw = '```json\n' + JSON.stringify({ concepts: [{ index: 0, title: 'T', description: 'D' }] }) + '\n```';
    const out = parseMarketPulseResponse(raw, clusters);
    expect(out[0]).toMatchObject({ title: 'T', description: 'D' });
  });

  it('returns the deterministic base on malformed JSON', () => {
    const out = parseMarketPulseResponse('not json at all', clusters);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: 'Fail & Frustration', title: 'Fail & Frustration', description: '' });
  });
});
