import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDocs: Map<string, any> = new Map();

vi.mock('firebase-admin', () => ({
  firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', arrayUnion: (v: any) => v } },
}));

vi.mock('firebase-admin/firestore', () => {
  const mockCollection = (name: string) => ({
    doc: (id: string) => ({
      get: async () => {
        const key = `${name}/${id}`;
        const data = mockDocs.get(key);
        return { exists: !!data, data: () => data, id };
      },
      set: async (d: any) => { mockDocs.set(`${name}/${id}`, d); },
      update: async (d: any) => {
        const key = `${name}/${id}`;
        mockDocs.set(key, { ...mockDocs.get(key), ...d });
      },
    }),
    where: (field: string, _op: string, value: any) => ({
      get: async () => {
        const results: any[] = [];
        for (const [key, data] of mockDocs.entries()) {
          if (key.startsWith(name + '/') && data[field] === value) {
            results.push({ id: key.split('/')[1], data: () => data, ref: {} });
          }
        }
        return { docs: results };
      },
    }),
  });

  return {
    getFirestore: () => ({
      collection: mockCollection,
    }),
  };
});

vi.mock('../sensorTower/client', () => ({
  sensorTowerAuthToken: { value: () => 'fake-token' },
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: any, handler: any) => handler,
}));

vi.mock('../creativeInsights/runForGenre', () => ({
  runCreativePipelineForGenre: vi.fn(),
}));

vi.mock('../adIntel/reaper', () => ({
  reapStaleCreatives: vi.fn().mockResolvedValue(0),
}));

import { getMissingMonths, getMissingWeeks } from '../sensorTower/fetchTopApps';
import type { GenreDoc } from '../sensorTower/fetchTopApps';

beforeEach(() => {
  mockDocs.clear();
});

describe('getMissingMonths', () => {
  const genre: GenreDoc = {
    id: 'genre1',
    name: 'Puzzle',
    categoryIds: { ios: '7012', android: 'GAME_PUZZLE' },
    active: true,
    monthsBack: 3,
  };

  it('returns all months when no snapshots exist', async () => {
    const missing = await getMissingMonths(genre);
    expect(missing).toHaveLength(3);
  });

  it('skips months that already have snapshot docs', async () => {
    const missing = await getMissingMonths(genre);
    mockDocs.set(`snapshots/genre1_${missing[0].month}`, {
      genreId: 'genre1',
      month: missing[0].month,
    });

    const missingAfter = await getMissingMonths(genre);
    expect(missingAfter).toHaveLength(2);
    expect(missingAfter.map((m: any) => m.month)).not.toContain(missing[0].month);
  });

  it('returns empty when all months are present', async () => {
    const missing = await getMissingMonths(genre);
    for (const m of missing) {
      mockDocs.set(`snapshots/genre1_${m.month}`, {
        genreId: 'genre1',
        month: m.month,
      });
    }

    const missingAfter = await getMissingMonths(genre);
    expect(missingAfter).toHaveLength(0);
  });
});

describe('getMissingWeeks', () => {
  const genre: GenreDoc = {
    id: 'genre1',
    name: 'Puzzle',
    categoryIds: { ios: '7012', android: 'GAME_PUZZLE' },
    active: true,
  };

  it('returns all weeks when no snapshots exist', async () => {
    const missing = await getMissingWeeks(genre);
    expect(missing).toHaveLength(6);
  });

  it('skips weeks that already have snapshot docs', async () => {
    const missing = await getMissingWeeks(genre);
    mockDocs.set(`snapshots/genre1_week_${missing[0].week}`, {
      genreId: 'genre1',
      week: missing[0].week,
    });

    const missingAfter = await getMissingWeeks(genre);
    expect(missingAfter).toHaveLength(5);
    expect(missingAfter.map((w: any) => w.week)).not.toContain(missing[0].week);
  });
});
