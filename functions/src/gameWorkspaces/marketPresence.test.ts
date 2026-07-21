import { describe, it, expect } from 'vitest';
import {
  buildCountryPresence,
  buildOsPresence,
  fetchMarketPresenceWithDeps,
  type AppMarketRow,
  type MarketApp,
} from './marketPresence';

const apps: MarketApp[] = [
  { appId: 'focus', iosAppId: 'ios-focus', androidAppId: 'and-focus', isFocus: true },
  { appId: 'compA', iosAppId: 'ios-A', androidAppId: 'and-A', isFocus: false },
  { appId: 'compB', iosAppId: 'ios-B', androidAppId: null, isFocus: false },
];

describe('buildCountryPresence', () => {
  it('splits focus vs competitors and computes share', () => {
    const rows = new Map<string, AppMarketRow>([
      ['focus', { appId: 'focus', revenue: 100, downloads: 10 }],
      ['compA', { appId: 'compA', revenue: 300, downloads: 30 }],
      ['compB', { appId: 'compB', revenue: 100, downloads: 20 }],
    ]);
    const p = buildCountryPresence('US', apps, (a) => rows.get(a.appId));
    expect(p.focusRevenue).toBe(100);
    expect(p.competitorRevenue).toBe(400);
    expect(p.competitorGames).toBe(2);
    expect(p.focusShare).toBe(0.2); // 100 / 500
    expect(p.topCompetitors[0]).toEqual({ appId: 'compA', revenue: 300 });
  });

  it('treats apps missing from the top list as absent (a country opportunity)', () => {
    const rows = new Map<string, AppMarketRow>([
      ['compA', { appId: 'compA', revenue: 500, downloads: 50 }],
    ]);
    const p = buildCountryPresence('JP', apps, (a) => rows.get(a.appId));
    expect(p.focusRevenue).toBe(0);
    expect(p.competitorRevenue).toBe(500);
    expect(p.focusShare).toBe(0); // focus absent → clear gap
  });
});

describe('buildOsPresence', () => {
  it('matches apps by their store id, not the unified id', () => {
    const iosRows = new Map<string, AppMarketRow>([
      ['ios-focus', { appId: 'ios-focus', revenue: 50, downloads: 5 }],
      ['ios-A', { appId: 'ios-A', revenue: 150, downloads: 15 }],
    ]);
    const p = buildOsPresence('ios', apps, (a) => (a.iosAppId ? iosRows.get(a.iosAppId) : undefined));
    expect(p.os).toBe('ios');
    expect(p.focusRevenue).toBe(50);
    expect(p.competitorRevenue).toBe(150);
    expect(p.competitorGames).toBe(1);
  });

  it('skips apps with no store id for that OS', () => {
    const andRows = new Map<string, AppMarketRow>([
      ['and-focus', { appId: 'and-focus', revenue: 40, downloads: 4 }],
      ['and-A', { appId: 'and-A', revenue: 60, downloads: 6 }],
    ]);
    // compB has androidAppId null → excluded from android presence.
    const p = buildOsPresence('android', apps, (a) => (a.androidAppId ? andRows.get(a.androidAppId) : undefined));
    expect(p.competitorGames).toBe(1);
    expect(p.competitorRevenue).toBe(60);
  });
});

describe('fetchMarketPresenceWithDeps', () => {
  it('sorts countries by competitor revenue and runs both OS splits', async () => {
    const presence = await fetchMarketPresenceWithDeps({
      apps,
      category: '7001',
      countries: ['US', 'JP'],
      primaryCountry: 'US',
      month: '2026-06',
      fetchTop: async (os, country) => {
        if (os === 'unified' && country === 'US') {
          return [{ appId: 'compA', revenue: 100, downloads: 10 }];
        }
        if (os === 'unified' && country === 'JP') {
          return [{ appId: 'compA', revenue: 900, downloads: 90 }];
        }
        if (os === 'ios') return [{ appId: 'ios-A', revenue: 20, downloads: 2 }];
        if (os === 'android') return [{ appId: 'and-A', revenue: 30, downloads: 3 }];
        return [];
      },
    });

    // JP has the bigger competitor revenue → sorted first.
    expect(presence.byCountry[0].country).toBe('JP');
    expect(presence.byCountry[0].competitorRevenue).toBe(900);
    expect(presence.byOs.map((o) => o.os)).toEqual(['ios', 'android']);
    expect(presence.byOs[0].competitorRevenue).toBe(20);
    expect(presence.byOs[1].competitorRevenue).toBe(30);
  });
});
