import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { planCrawl, shiftDate } from './fetchXray';
import { CallMeter, endpointCredits, endpointFamily, usageMonthKey } from './usage';

/**
 * Guards on the pieces that decide how much AppBird quota a run may spend. X-Ray
 * has a small monthly allowance, so a regression here is expensive.
 */

describe('shiftDate', () => {
  it('walks back across month and year boundaries', () => {
    expect(shiftDate('2026-08-04', 2)).toBe('2026-08-02');
    expect(shiftDate('2026-08-01', 2)).toBe('2026-07-30');
    expect(shiftDate('2026-01-01', 1)).toBe('2025-12-31');
    expect(shiftDate('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(shiftDate('not-a-date', 2)).toBe('not-a-date');
  });
});

describe('planCrawl', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('does a full crawl on the first run', () => {
    const plan = planCrawl({ lastTeardownDate: null, lastFullCrawlAt: null }, { now });
    expect(plan.full).toBe(true);
    expect(plan.teardownDateFrom).toBeUndefined();
  });

  it('goes incremental once a previous sync exists, with overlap for day granularity', () => {
    const plan = planCrawl(
      { lastTeardownDate: '2026-08-03', lastFullCrawlAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00Z')) },
      { now },
    );
    expect(plan.full).toBe(false);
    // Two days of overlap: teardownDateFrom is day-granular, so re-reading the
    // boundary is what guarantees same-day teardowns aren't missed.
    expect(plan.teardownDateFrom).toBe('2026-08-01');
  });

  it('forces a full crawl once the periodic interval has elapsed', () => {
    const stale = planCrawl(
      { lastTeardownDate: '2026-08-03', lastFullCrawlAt: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')) },
      { now },
    );
    expect(stale.full).toBe(true);
    expect(stale.reason).toMatch(/periodic/);
  });

  it('honours an explicit full-crawl request', () => {
    const plan = planCrawl(
      { lastTeardownDate: '2026-08-03', lastFullCrawlAt: Timestamp.fromDate(now) },
      { force: true, now },
    );
    expect(plan.full).toBe(true);
  });

  it('treats a never-full-crawled state as due for one', () => {
    const plan = planCrawl({ lastTeardownDate: '2026-08-03', lastFullCrawlAt: null }, { now });
    expect(plan.full).toBe(true);
  });
});

describe('endpointFamily', () => {
  it('collapses per-id paths to the billable family', () => {
    expect(endpointFamily('/v1/apps/6758342097')).toBe('apps');
    expect(endpointFamily('/v1/xray-reports')).toBe('xray-reports');
    expect(endpointFamily('/v1/xray-reports/4772129')).toBe('xray-reports');
    expect(endpointFamily('/v1/developers/123')).toBe('developers');
  });

  it('degrades gracefully on unexpected paths', () => {
    expect(endpointFamily('/')).toBe('unknown');
  });
});

/**
 * Pricing is what makes the budget gate meaningful: a full crawl is 24 requests but
 * ~3,600 credits, and a request counter cannot tell those apart.
 */
describe('endpointCredits', () => {
  it('prices the report list and the teardown differently despite one family', () => {
    // endpointFamily deliberately collapses these two; pricing must not.
    expect(endpointFamily('/v1/xray-reports')).toBe(endpointFamily('/v1/xray-reports/4772129'));
    expect(endpointCredits('/v1/xray-reports')).toBe(150);
    expect(endpointCredits('/v1/xray-reports/4772129')).toBe(500);
  });

  it('prices the integration vocabulary as the cheap lookup it is', () => {
    expect(endpointCredits('/v1/xray-integrations')).toBe(5);
  });

  it('leaves non-X-Ray endpoints unpriced, since they draw on another quota', () => {
    expect(endpointCredits('/v1/apps/6758342097')).toBeNull();
    expect(endpointCredits('/v1/developers/123')).toBeNull();
    expect(endpointCredits('/')).toBeNull();
  });

  it('prices a full crawl at the number that alarmed us, not the request count', () => {
    const pages = 24;
    expect(pages * (endpointCredits('/v1/xray-reports') ?? 0)).toBe(3600);
  });
});

describe('CallMeter', () => {
  it('counts every attempt, including retries, per family', () => {
    const meter = new CallMeter();
    meter.countAttempt('/v1/xray-reports');
    meter.countAttempt('/v1/xray-reports');
    meter.countAttempt('/v1/apps/123');
    expect(meter.total).toBe(3);
    expect(meter.byEndpoint()).toEqual({ 'xray-reports': 2, apps: 1 });
  });

  it('accumulates weighted credits alongside the request count', () => {
    const meter = new CallMeter();
    meter.countAttempt('/v1/xray-reports');
    meter.countAttempt('/v1/xray-reports/4772129');
    meter.countAttempt('/v1/xray-integrations');
    // Unpriced: on the other quota, so it moves `total` but not credits.
    meter.countAttempt('/v1/apps/123');
    expect(meter.total).toBe(4);
    expect(meter.xrayCredits).toBe(150 + 500 + 5);
  });

  it('flushing an empty meter touches nothing', async () => {
    const meter = new CallMeter();
    let called = false;
    const db = {
      collection: () => {
        called = true;
        return { doc: () => ({ set: async () => undefined }) };
      },
    } as never;
    await meter.flush(db);
    expect(called).toBe(false);
  });
});

describe('usageMonthKey', () => {
  it('buckets by UTC month', () => {
    expect(usageMonthKey(new Date('2026-08-04T23:59:59Z'))).toBe('2026-08');
    expect(usageMonthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});
