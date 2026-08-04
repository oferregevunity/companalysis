import { describe, it, expect } from 'vitest';
import { normalizeApp } from './client';

/**
 * The normalized app is written straight to Firestore, which rejects `undefined`
 * — so the guarantee under test is "every field is a value or null, whatever the
 * payload looks like".
 */
function assertNoUndefined(value: unknown, path = 'app'): void {
  expect(value, `${path} is undefined`).not.toBeUndefined();
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

describe('normalizeApp', () => {
  it('maps a full App Store payload', () => {
    const app = normalizeApp(
      {
        storeId: '6758342097',
        store: 'AppStore',
        isGame: true,
        bundleId: 'com.color.pixel.blast.flow',
        name: 'Top Fishing: Reel Spin Master',
        releasedAt: '2026-05-01T07:00:00.000Z',
        updatedAt: '2026-09-01T07:00:00.000Z',
        deletedAt: null,
        firstSeenAt: '2026-07-13T05:31:07.702Z',
        lastSeenAt: '2026-08-04T08:52:47.172Z',
        categories: [{ name: 'Casual', slug: 'casual' }, { name: 'Games', slug: 'games' }],
        tags: [],
        storeTags: ['Match 3'],
        iconUrl: 'https://example.test/icon.png',
        coverUrl: null,
        developer: {
          storeId: '6785517819',
          name: 'Topzest Games Limited',
          legalName: 'Topzest Games Limited',
          storePageUrl: 'https://apps.apple.com/GB/developer/id6785517819',
          website: 'https://topzgames.com/',
          email: null,
          iconUrl: null,
          isStarred: false,
          isPublisher: false,
        },
        storefront: { country: 'GB', language: 'en', pageUrl: 'https://apps.apple.com/gb/app/id6758342097' },
        summary: 'Go Catch Big Cat in Deep Water',
        description: 'Long description',
        appVersion: '1.0.1',
        filesize: '495 MB',
        screenshots: ['https://example.test/s1.png'],
        ipadScreenshots: ['https://example.test/i1.png'],
        videos: [{ previewUrl: 'https://example.test/p.jpg', videoUrl: 'https://example.test/v.mp4' }],
        requiredOsVersion: '13.0',
        contentRating: '12+',
        privacyPolicyUrl: 'https://topzgames.com/privacy',
        website: 'https://topzgames.com/',
        permissions: [{ label: 'Data Used to Track You', permissions: ['Identifiers'] }],
        free: true,
        hasIap: true,
        comingSoon: true,
        iapItems: [{ title: 'offer_280', price: '£299.99' }],
        iapPriceRange: '£199.99 - £299.99',
        price: 0,
        currency: 'GBP',
        rating: 0,
        histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        numberVoters: 0,
        numberReviews: 0,
        installs: 0,
        linkedApps: [{ store: 'GooglePlay', storeId: 'com.color.pixel.blast.flow', name: 'Top Fishing' }],
        categoryRankings: [],
      },
      '6758342097',
    );

    expect(app.name).toBe('Top Fishing: Reel Spin Master');
    expect(app.comingSoon).toBe(true);
    expect(app.categories.map((c) => c.slug)).toEqual(['casual', 'games']);
    expect(app.linkedApps[0].store).toBe('GooglePlay');
    expect(app.videos[0].videoUrl).toBe('https://example.test/v.mp4');
    expect(app.iapItems).toHaveLength(1);
    assertNoUndefined(app);
  });

  it('maps Play-specific fields (installs, rankings, android permissions)', () => {
    const app = normalizeApp(
      {
        storeId: 'com.king.candycrushsaga',
        store: 'GooglePlay',
        isGame: true,
        name: 'Candy Crush Saga',
        installs: 2300749731,
        rating: 4.63,
        numberVoters: 38917368,
        numberReviews: 2090441,
        histogram: { 1: 1095821, 2: 465408, 3: 1662951, 4: 5380919, 5: 30312250 },
        filesize: null,
        free: true,
        hasIap: true,
        comingSoon: false,
        permissions: [{ label: 'Wi-Fi connection information', permissions: ['view Wi-Fi connections'] }],
        categoryRankings: [
          {
            categoryName: 'Games / Casual',
            categorySlug: 'casual',
            rank: 1,
            isGames: true,
            collection: 'TopGrossing',
            device: 'android',
          },
        ],
      },
      'com.king.candycrushsaga',
    );

    expect(app.installs).toBe(2300749731);
    expect(app.filesize).toBeNull();
    expect(app.categoryRankings[0]).toMatchObject({ rank: 1, collection: 'TopGrossing' });
    expect(app.histogram['5']).toBe(30312250);
    assertNoUndefined(app);
  });

  it('survives a sparse payload without undefined or throwing', () => {
    const app = normalizeApp({ storeId: 'com.x.y', store: 'GooglePlay', name: 'X' }, 'com.x.y');

    expect(app.name).toBe('X');
    expect(app.developer).toBeNull();
    expect(app.storefront).toBeNull();
    expect(app.screenshots).toEqual([]);
    expect(app.categories).toEqual([]);
    expect(app.hasIap).toBeNull();
    expect(app.comingSoon).toBeNull();
    expect(app.rating).toBe(0);
    expect(app.histogram).toEqual({});
    assertNoUndefined(app);
  });

  it('falls back to the requested store id and drops malformed entries', () => {
    const app = normalizeApp(
      {
        categories: [{ slug: 'no-name' }, null, { name: 'Sports', slug: 'sports' }],
        tags: ['ok', 42, null],
        linkedApps: [{ store: 'AppStore' }, { store: 'AppStore', storeId: '553834731' }],
        categoryRankings: [{ categoryName: 'Games', rank: 'nope' }],
        videos: ['not-an-object'],
        price: 'free',
        free: false,
      },
      'fallback-id',
    );

    expect(app.storeId).toBe('fallback-id');
    expect(app.name).toBe('fallback-id');
    expect(app.categories).toEqual([{ name: 'Sports', slug: 'sports' }]);
    expect(app.tags).toEqual(['ok']);
    expect(app.linkedApps).toEqual([{ store: 'AppStore', storeId: '553834731', name: '553834731' }]);
    expect(app.categoryRankings).toEqual([]);
    expect(app.videos).toEqual([]);
    expect(app.price).toBe(0);
    expect(app.free).toBe(false);
    assertNoUndefined(app);
  });
});
