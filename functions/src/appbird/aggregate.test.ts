import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppbirdDeveloperResponse } from './client';

// Controlled tracked-developer set: two publishers, one dev each.
vi.mock('./publishers', () => ({
  trackedDevelopers: () => [
    { storeId: 'A', store: 'AppStore', publisherLabel: 'Voodoo', country: 'FR' },
    { storeId: 'B', store: 'GooglePlay', publisherLabel: 'Rollic', country: 'TR' },
  ],
}));

const responses: Record<string, AppbirdDeveloperResponse> = {
  A: {
    developer: { storeId: 'A', name: 'Voodoo', country: 'FR', isPublisher: true, isStarred: true, iconUrl: null },
    countApps: 2,
    linkedDevelopers: [],
    ownershipTransfers: [
      {
        app: { storeId: 'app.x', name: 'X', iconUrl: null, store: 'AppStore' },
        fromDeveloper: { storeId: 'S', name: 'Small Studio', isStarred: false, isPublisher: false },
        toDeveloper: { storeId: 'A', name: 'Voodoo', isStarred: true, isPublisher: true },
        detectedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        app: { storeId: 'app.y', name: 'Y', iconUrl: null, store: 'AppStore' },
        fromDeveloper: { storeId: 'A', name: 'Voodoo', isStarred: true, isPublisher: true },
        toDeveloper: { storeId: 'B', name: 'Rollic', isStarred: true, isPublisher: true },
        detectedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  B: {
    developer: { storeId: 'B', name: 'Rollic', country: 'TR', isPublisher: true, isStarred: true, iconUrl: null },
    countApps: 1,
    linkedDevelopers: [],
    ownershipTransfers: [
      // Same A -> B transfer as above: must dedupe to one row.
      {
        app: { storeId: 'app.y', name: 'Y', iconUrl: null, store: 'AppStore' },
        fromDeveloper: { storeId: 'A', name: 'Voodoo', isStarred: true, isPublisher: true },
        toDeveloper: { storeId: 'B', name: 'Rollic', isStarred: true, isPublisher: true },
        detectedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
};

vi.mock('./client', () => ({
  getDeveloper: vi.fn(async (storeId: string) => responses[storeId]),
}));

import { aggregateTransfers } from './fetchTransfers';

describe('aggregateTransfers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unions, dedupes, sorts newest-first, and enriches country', async () => {
    const { transfers, developersFetched, errors } = await aggregateTransfers('key');

    expect(developersFetched).toBe(2);
    expect(errors).toEqual([]);
    // X -> A and A -> B, deduped to two unique rows.
    expect(transfers).toHaveLength(2);

    // Newest first.
    expect(transfers[0].app.storeId).toBe('app.x');
    expect(transfers[1].app.storeId).toBe('app.y');

    // X row: acquiring side A is tracked (FR); selling side S unknown.
    expect(transfers[0].to.country).toBe('FR');
    expect(transfers[0].from.country).toBeNull();

    // Y row: both sides tracked → both flags; surfaced by both publishers.
    expect(transfers[1].from.country).toBe('FR');
    expect(transfers[1].to.country).toBe('TR');
    expect(transfers[1].trackedPublishers.sort()).toEqual(['Rollic', 'Voodoo']);
  });
});
