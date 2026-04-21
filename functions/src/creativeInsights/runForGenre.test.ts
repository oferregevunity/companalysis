import { describe, it, expect, vi } from 'vitest';
import { runCreativePipelineForGenreWithDeps } from './runForGenre';

const genre = { id: 'g1', name: 'Match 3' };

describe('runCreativePipelineForGenreWithDeps', () => {
  it('calls fetch → score → insights in order and reports success', async () => {
    const order: string[] = [];
    const fetchCreatives = vi.fn(async () => {
      order.push('fetch');
      return { success: true, creativeCount: 42, partialErrors: [] };
    });
    const scoreCreatives = vi.fn(async () => {
      order.push('score');
      return { scored: 40 };
    });
    const generateInsights = vi.fn(async () => {
      order.push('insights');
      return { ok: true, winners: 5 };
    });

    const res = await runCreativePipelineForGenreWithDeps({
      genre,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 'tok',
      fetchCreatives,
      scoreCreatives,
      generateInsights,
      weekKeyFromStart: () => '2026-W16',
    });

    expect(order).toEqual(['fetch', 'score', 'insights']);
    expect(fetchCreatives).toHaveBeenCalledWith(genre, '2026-04-13', '2026-04-19', 'tok');
    expect(scoreCreatives).toHaveBeenCalledWith('g1', '2026-W16');
    expect(generateInsights).toHaveBeenCalledWith('g1', '2026-W16', 'Match 3');
    expect(res).toEqual({
      success: true,
      creativeCount: 42,
      scoredCount: 40,
      insightsGenerated: true,
      partialErrors: [],
    });
  });

  it('propagates partialErrors from fetch and still runs score/insights', async () => {
    const fetchCreatives = vi.fn(async () => ({
      success: false,
      creativeCount: 20,
      partialErrors: ['Instagram:429'],
    }));
    const scoreCreatives = vi.fn(async () => ({ scored: 20 }));
    const generateInsights = vi.fn(async () => ({ ok: true, winners: 3 }));

    const res = await runCreativePipelineForGenreWithDeps({
      genre,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 't',
      fetchCreatives,
      scoreCreatives,
      generateInsights,
      weekKeyFromStart: () => '2026-W16',
    });

    expect(scoreCreatives).toHaveBeenCalled();
    expect(generateInsights).toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.insightsGenerated).toBe(true);
    expect(res.partialErrors).toContain('Instagram:429');
    expect(res.scoredCount).toBe(20);
  });

  it('records a gemini partial error when the insights result contains geminiError', async () => {
    const res = await runCreativePipelineForGenreWithDeps({
      genre,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 't',
      fetchCreatives: async () => ({ success: true, creativeCount: 10, partialErrors: [] }),
      scoreCreatives: async () => ({ scored: 10 }),
      generateInsights: async () => ({ ok: false, winners: 0, geminiError: 'timeout' }),
      weekKeyFromStart: () => '2026-W16',
    });
    expect(res.success).toBe(false);
    expect(res.insightsGenerated).toBe(false);
    expect(res.partialErrors.some(e => e.includes('gemini') && e.includes('timeout'))).toBe(true);
  });

  it('records a gemini partial error when generateInsights throws', async () => {
    const res = await runCreativePipelineForGenreWithDeps({
      genre,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 't',
      fetchCreatives: async () => ({ success: true, creativeCount: 10, partialErrors: [] }),
      scoreCreatives: async () => ({ scored: 10 }),
      generateInsights: async () => {
        throw new Error('boom');
      },
      weekKeyFromStart: () => '2026-W16',
    });
    expect(res.success).toBe(false);
    expect(res.insightsGenerated).toBe(false);
    expect(res.partialErrors.some(e => e.includes('gemini') && e.includes('boom'))).toBe(true);
  });

  it('records a score partial error when scoreCreatives throws and still runs insights', async () => {
    const generateInsights = vi.fn(async () => ({ ok: true, winners: 0 }));
    const res = await runCreativePipelineForGenreWithDeps({
      genre,
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      authToken: 't',
      fetchCreatives: async () => ({ success: true, creativeCount: 10, partialErrors: [] }),
      scoreCreatives: async () => {
        throw new Error('fs down');
      },
      generateInsights,
      weekKeyFromStart: () => '2026-W16',
    });
    expect(generateInsights).toHaveBeenCalled();
    expect(res.scoredCount).toBe(0);
    expect(res.partialErrors.some(e => e.includes('score') && e.includes('fs down'))).toBe(true);
    expect(res.success).toBe(false);
  });

  it('rethrows when fetchCreatives throws', async () => {
    await expect(
      runCreativePipelineForGenreWithDeps({
        genre,
        weekStart: '2026-04-13',
        weekEnd: '2026-04-19',
        authToken: 't',
        fetchCreatives: async () => {
          throw new Error('401');
        },
        scoreCreatives: async () => ({ scored: 0 }),
        generateInsights: async () => ({ ok: true, winners: 0 }),
        weekKeyFromStart: () => '2026-W16',
      }),
    ).rejects.toThrow('401');
  });
});
