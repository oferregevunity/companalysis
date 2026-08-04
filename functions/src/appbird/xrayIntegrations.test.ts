import { describe, it, expect } from 'vitest';
import { normalizeXrayIntegration } from './xrayClient';
import { planIntegrationRefresh } from './fetchXray';

/**
 * The live shape of `GET /v1/xray-integrations` is unconfirmed (no spec, and the
 * endpoint postdates our newest crawled snapshot), so the normalizer deliberately
 * accepts several plausible conventions. These cases pin that tolerance down —
 * whichever shape the API actually returns, one of them should already hold.
 */

describe('normalizeXrayIntegration', () => {
  it('accepts a flat string vocabulary', () => {
    expect(normalizeXrayIntegration('AppLovin MAX')).toEqual({
      value: 'AppLovin MAX',
      label: 'AppLovin MAX',
      category: null,
      appCount: null,
    });
  });

  it('trims strings and drops empty ones', () => {
    expect(normalizeXrayIntegration('  Firebase  ')?.value).toBe('Firebase');
    expect(normalizeXrayIntegration('   ')).toBeNull();
    expect(normalizeXrayIntegration('')).toBeNull();
  });

  it('keeps slug and label separate when the API distinguishes them', () => {
    expect(normalizeXrayIntegration({ value: 'applovin-max', name: 'AppLovin MAX' })).toEqual({
      value: 'applovin-max',
      label: 'AppLovin MAX',
      category: null,
      appCount: null,
    });
  });

  it('falls back to the label as the filter value when there is no slug', () => {
    const i = normalizeXrayIntegration({ name: 'Adjust' });
    expect(i).toEqual({ value: 'Adjust', label: 'Adjust', category: null, appCount: null });
  });

  it('reads the label from any of the observed key spellings', () => {
    for (const key of ['name', 'label', 'integration', 'sdk', 'sdkName', 'value']) {
      expect(normalizeXrayIntegration({ [key]: 'Unity Ads' })?.label).toBe('Unity Ads');
    }
  });

  it('reads category and app count from any of the observed key spellings', () => {
    expect(normalizeXrayIntegration({ name: 'ironSource', category: 'Ad Network', appCount: 42 })).toEqual({
      value: 'ironSource',
      label: 'ironSource',
      category: 'Ad Network',
      appCount: 42,
    });
    expect(normalizeXrayIntegration({ name: 'GameAnalytics', type: 'Analytics', count: 7 })?.category).toBe('Analytics');
    expect(normalizeXrayIntegration({ name: 'GameAnalytics', reportCount: 7 })?.appCount).toBe(7);
  });

  it('nulls a count that is not a finite number rather than storing NaN', () => {
    expect(normalizeXrayIntegration({ name: 'X', appCount: 'many' })?.appCount).toBeNull();
    expect(normalizeXrayIntegration({ name: 'X', appCount: Number.NaN })?.appCount).toBeNull();
  });

  it('drops rows with no usable name instead of producing a junk facet', () => {
    expect(normalizeXrayIntegration({ appCount: 3 })).toBeNull();
    expect(normalizeXrayIntegration({})).toBeNull();
    expect(normalizeXrayIntegration(null)).toBeNull();
    expect(normalizeXrayIntegration(undefined)).toBeNull();
    expect(normalizeXrayIntegration(42)).toBeNull();
  });
});

/**
 * Membership pages are billed per request, so these cases are a cost policy, not
 * just control flow: every `full` is potentially a multi-page spend, every `serve`
 * is free, and `incremental` is the one page that keeps a refresh cheap.
 */
describe('planIntegrationRefresh', () => {
  const now = new Date('2026-08-04T12:00:00Z');
  const fresh = {
    fetchedAt: '2026-08-01T00:00:00.000Z',
    partial: false,
    corpusTeardownDate: '2026-07-30',
  };

  it('resolves from scratch when nothing is cached', () => {
    const plan = planIntegrationRefresh(null, '2026-07-30', { now });
    expect(plan.action).toBe('full');
  });

  it('serves the cache for free while the corpus has not advanced', () => {
    const plan = planIntegrationRefresh(fresh, '2026-07-30', { now });
    expect(plan.action).toBe('serve');
    expect(plan.teardownDateFrom).toBeUndefined();
  });

  it('tops up incrementally when the corpus advanced, instead of re-resolving', () => {
    const plan = planIntegrationRefresh(fresh, '2026-08-03', { now });
    expect(plan.action).toBe('incremental');
    // Overlapped by the same margin as the main crawl: teardownDateFrom is
    // day-granular, so the boundary day must be re-read.
    expect(plan.teardownDateFrom).toBe('2026-07-28');
  });

  it('re-resolves fully once past the backstop interval, to catch removals', () => {
    const stale = { ...fresh, fetchedAt: '2026-07-01T00:00:00.000Z' };
    const plan = planIntegrationRefresh(stale, '2026-07-30', { now });
    expect(plan.action).toBe('full');
    expect(plan.reason).toMatch(/re-resolve interval/);
  });

  it('honours an explicit refresh', () => {
    expect(planIntegrationRefresh(fresh, '2026-07-30', { refresh: true, now }).action).toBe('full');
  });

  it('serves a partial result as-is, and only completes it when asked', () => {
    const partial = { ...fresh, partial: true };
    // Serving is the default: re-resolving would spend the pages the cap avoided.
    expect(planIntegrationRefresh(partial, '2026-07-30', { now }).action).toBe('serve');
    expect(planIntegrationRefresh(partial, '2026-07-30', { fetchAll: true, now }).action).toBe('full');
  });

  it('rebuilds rather than guessing a lower bound when no corpus date was stamped', () => {
    const plan = planIntegrationRefresh({ ...fresh, corpusTeardownDate: null }, '2026-08-03', { now });
    expect(plan.action).toBe('full');
  });

  it('rebuilds when fetchedAt is unparseable rather than serving it forever', () => {
    const plan = planIntegrationRefresh({ ...fresh, fetchedAt: 'not-a-date' }, '2026-07-30', { now });
    expect(plan.action).toBe('full');
  });
});
