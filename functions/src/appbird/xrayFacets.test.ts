import { describe, it, expect } from 'vitest';
import {
  buildFacets,
  normalizeEngine,
  normalizeMediator,
  normalizePublisherSdk,
  reportFacets,
} from './xrayFacets';
import type { XrayReportSummary } from './xrayClient';

function report(over: Partial<XrayReportSummary>): XrayReportSummary {
  return {
    reportId: Math.random().toString(36).slice(2),
    storeId: '1',
    bundleId: null,
    store: 'AppStore',
    appName: 'Game',
    version: null,
    storeVersion: null,
    publisher: null,
    publisherSdk: null,
    engine: null,
    mediator: null,
    sdkCount: 0,
    adNetworkCount: 0,
    scriptCount: 0,
    hasDashboard: false,
    hasDiff: false,
    teardownDate: null,
    publishedAt: null,
    updatedAt: null,
    ...over,
  };
}

describe('normalizeMediator', () => {
  // All spellings below are real values observed in the live corpus.
  it('collapses AppLovin MAX spellings into one group', () => {
    for (const raw of ['AppLovin MAX', 'MAX', 'AppLovin MAX (via Elephant)', 'AppLovin MAX (via Lion Studios Suite)']) {
      expect(normalizeMediator(raw).key, raw).toBe('applovin-max');
      expect(normalizeMediator(raw).label, raw).toBe('AppLovin MAX');
    }
    expect(normalizeMediator('AppLovin MAX (via Elephant)').variant).toBe('via Elephant');
    expect(normalizeMediator('AppLovin MAX').variant).toBeNull();
  });

  it('treats ironSource and LevelPlay as the same product', () => {
    expect(normalizeMediator('ironSource').key).toBe('levelplay');
    expect(normalizeMediator('LevelPlay').key).toBe('levelplay');
    expect(normalizeMediator('ironSource LevelPlay (via Supersonic Wisdom)').key).toBe('levelplay');
    expect(normalizeMediator('ironSource LevelPlay (via Supersonic Wisdom)').variant).toBe('via Supersonic Wisdom');
  });

  it('groups AdMob and TopOn variants', () => {
    expect(normalizeMediator('AdMob (direct)').key).toBe('admob');
    expect(normalizeMediator('AdMob Mediation').key).toBe('admob');
    expect(normalizeMediator('TopOn (AnyThink)').key).toBe('topon');
  });

  it('keeps None distinct from unknown, preserving the qualifier', () => {
    expect(normalizeMediator('None').key).toBe('none');
    expect(normalizeMediator('None (dummy ads)')).toMatchObject({ key: 'none', variant: 'dummy ads' });
    expect(normalizeMediator(null).key).toBe('unknown');
    expect(normalizeMediator('   ').key).toBe('unknown');
  });

  it('falls back to the raw value for unrecognized stacks', () => {
    expect(normalizeMediator('SmartDigiMktTech + HyperBid').key).toBe('hyperbid');
    expect(normalizeMediator('AdsUp hybrid mediation')).toMatchObject({
      key: 'adsuphybridmediation',
      label: 'AdsUp hybrid mediation',
    });
  });

  it('ignores spacing and casing drift when falling back', () => {
    // Both spellings occur in the corpus and must not split into two groups.
    expect(normalizeMediator('CleverAdsSolutions').key).toBe(normalizeMediator('Clever Ads Solutions').key);
  });

  it('groups publisher-owned mediation wrappers under one banner each', () => {
    for (const raw of ['TinySauce', 'TinySauce built-in', 'VoodooSauce', 'Voodoo Tiny Sauce', 'TSAdsManager', 'VoodooSauce ads']) {
      expect(normalizeMediator(raw).key, raw).toBe('tinysauce');
    }
    expect(normalizeMediator('Homa Belly').key).toBe('homa');
    expect(normalizeMediator('Supersonic Wisdom (wraps mediation)').key).toBe('supersonicwisdom');
  });

  it('credits the mediation product, not the wrapper that embeds it', () => {
    // The wrapper rules must not outrank the real product: these are MAX and
    // LevelPlay builds that a publisher SDK happens to wrap.
    expect(normalizeMediator('AppLovin MAX (via Elephant)').key).toBe('applovin-max');
    expect(normalizeMediator('AppLovin MAX (via TinySauce)').key).toBe('applovin-max');
    expect(normalizeMediator('ironSource LevelPlay (via Supersonic Wisdom)').key).toBe('levelplay');
    expect(normalizeMediator('MAX (via Homa Belly)').key).toBe('applovin-max');
  });

  it('does not match MAX inside a longer word', () => {
    expect(normalizeMediator('MAXimus Ads').key).not.toBe('applovin-max');
  });
});

describe('normalizePublisherSdk', () => {
  it('normalizes self-publish spellings and absence', () => {
    expect(normalizePublisherSdk('Self-Publish').key).toBe('self-publish');
    expect(normalizePublisherSdk('Self-Published').key).toBe('self-publish');
    expect(normalizePublisherSdk('No publisher SDK').key).toBe('none');
  });

  it('extracts the owning publisher as the variant', () => {
    expect(normalizePublisherSdk('TinySauce (Voodoo)')).toMatchObject({
      key: 'tinysauce',
      label: 'TinySauce',
      variant: 'Voodoo',
    });
    expect(normalizePublisherSdk('Lion Studios Suite (Lion Studios)')).toMatchObject({
      key: 'lionstudiossuite',
      variant: 'Lion Studios',
    });
  });

  it('collapses ElephantSDK and SupersonicWisdom drift', () => {
    for (const raw of ['ElephantSDK', 'ElephantSDK (Rollic)', 'ElephantSDK / RollicMAX (Rollic)']) {
      expect(normalizePublisherSdk(raw).key, raw).toBe('elephantsdk');
    }
    expect(normalizePublisherSdk('SupersonicWisdom (Supersonic)').key).toBe('supersonicwisdom');
    expect(normalizePublisherSdk('Supersonic Wisdom').key).toBe('supersonicwisdom');
  });
});

describe('normalizeEngine', () => {
  it('groups Unity versions under one family, keeping the version', () => {
    expect(normalizeEngine('Unity 2022 LTS')).toMatchObject({ key: 'unity', label: 'Unity', variant: '2022 LTS' });
    expect(normalizeEngine('Unity 6.3').variant).toBe('6.3');
    expect(normalizeEngine('Unity').variant).toBeNull();
  });

  it('handles Native, Unreal and unknown engines', () => {
    expect(normalizeEngine('Native').key).toBe('native');
    expect(normalizeEngine('Native Android WebView shell').key).toBe('native');
    expect(normalizeEngine('Unreal Engine 5.4')).toMatchObject({ key: 'unreal', variant: '5.4' });
    expect(normalizeEngine(null).key).toBe('unknown');
  });
});

describe('reportFacets', () => {
  it('flattens all three dimensions onto one record', () => {
    expect(
      reportFacets(report({ mediator: 'MAX', publisherSdk: 'TinySauce (Voodoo)', engine: 'Unity 6.3' })),
    ).toEqual({
      mediatorKey: 'applovin-max',
      mediatorLabel: 'AppLovin MAX',
      mediatorVariant: 'MAX',
      publisherSdkKey: 'tinysauce',
      publisherSdkLabel: 'TinySauce',
      publisherSdkVariant: 'Voodoo',
      engineKey: 'unity',
      engineLabel: 'Unity',
      engineVersion: '6.3',
    });
  });
});

describe('buildFacets', () => {
  const reports = [
    report({ store: 'GooglePlay', mediator: 'AppLovin MAX', engine: 'Unity 6.3', publisherSdk: 'Self-Publish' }),
    report({ store: 'GooglePlay', mediator: 'MAX', engine: 'Unity 2022 LTS', publisherSdk: 'Self-Published' }),
    report({ store: 'AppStore', mediator: 'AppLovin MAX (via Elephant)', engine: 'Native', publisherSdk: 'ElephantSDK (Rollic)' }),
    report({ store: 'AppStore', mediator: 'ironSource', engine: 'Unity 6', publisherSdk: 'TinySauce (Voodoo)' }),
  ];

  it('ranks groups by count with share and store split', () => {
    const facets = buildFacets(reports);
    expect(facets.totalReports).toBe(4);

    const [top, second] = facets.mediator;
    expect(top).toMatchObject({
      key: 'applovin-max',
      count: 3,
      sharePct: 75,
      googlePlayCount: 2,
      appStoreCount: 1,
    });
    expect(second).toMatchObject({ key: 'levelplay', count: 1, sharePct: 25 });
  });

  it('reports the top raw variants inside a group', () => {
    const applovin = buildFacets(reports).mediator[0];
    expect(applovin.topVariants.map((v) => v.label)).toEqual(expect.arrayContaining(['MAX', 'via Elephant']));
  });

  it('groups Unity versions together and keeps Native separate', () => {
    const engine = buildFacets(reports).engine;
    expect(engine[0]).toMatchObject({ key: 'unity', count: 3 });
    expect(engine.find((b) => b.key === 'native')?.count).toBe(1);
  });

  it('returns empty dimensions for an empty corpus without dividing by zero', () => {
    const facets = buildFacets([]);
    expect(facets).toEqual({ totalReports: 0, mediator: [], publisherSdk: [], engine: [] });
  });
});
