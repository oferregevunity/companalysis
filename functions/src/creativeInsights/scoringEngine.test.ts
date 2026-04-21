import { describe, it, expect } from 'vitest';
import { computeLongevity, computeNetworkBreadth, computeImpressionMomentum } from './scoringEngine';
import type { AdNetwork } from '../adIntel/types';

describe('computeLongevity', () => {
  it('returns 0 for 0-day creatives', () => {
    expect(computeLongevity(0)).toBe(0);
  });
  it('returns ~8 pts at 7 days', () => {
    const v = computeLongevity(7);
    expect(v).toBeGreaterThanOrEqual(7);
    expect(v).toBeLessThanOrEqual(10);
  });
  it('returns ~18 pts at 30 days', () => {
    const v = computeLongevity(30);
    expect(v).toBeGreaterThanOrEqual(16);
    expect(v).toBeLessThanOrEqual(20);
  });
  it('caps at 25 pts at 60+ days', () => {
    expect(computeLongevity(60)).toBe(25);
    expect(computeLongevity(200)).toBe(25);
  });
  it('returns 0 for negative inputs (defensive)', () => {
    expect(computeLongevity(-5)).toBe(0);
  });
});

describe('computeNetworkBreadth', () => {
  it('returns 0 for empty', () => {
    expect(computeNetworkBreadth([])).toBe(0);
  });
  it('returns ~4 for 1 network', () => {
    expect(computeNetworkBreadth(['Facebook'])).toBeGreaterThanOrEqual(3);
    expect(computeNetworkBreadth(['Facebook'])).toBeLessThanOrEqual(5);
  });
  it('caps at 25 for 7+ networks', () => {
    const all: AdNetwork[] = ['Facebook', 'Instagram', 'TikTok', 'Applovin', 'Unity', 'Youtube', 'IronSource'];
    expect(computeNetworkBreadth(all)).toBe(25);
  });
  it('saturates at the cap for >7 networks', () => {
    const many: AdNetwork[] = ['Facebook', 'Instagram', 'TikTok', 'Applovin', 'Unity', 'Youtube', 'IronSource', 'Meta Audience Network', 'Admob'];
    expect(computeNetworkBreadth(many)).toBe(25);
  });
  it('deduplicates', () => {
    expect(computeNetworkBreadth(['Facebook', 'Facebook'])).toBeGreaterThanOrEqual(3);
    expect(computeNetworkBreadth(['Facebook', 'Facebook'])).toBeLessThanOrEqual(5);
  });
});

describe('computeImpressionMomentum', () => {
  it('returns 0 when no data', () => {
    expect(computeImpressionMomentum({ sovByWeek: {}, countriesByWeek: {} })).toBe(0);
  });
  it('returns 0 when only one observation per series', () => {
    expect(computeImpressionMomentum({
      sovByWeek: { w1: 0.1 },
      countriesByWeek: { w1: 1 },
    })).toBe(0);
  });
  it('rewards accelerating SoV', () => {
    const score = computeImpressionMomentum({
      sovByWeek: { w1: 0.01, w2: 0.03, w3: 0.08, w4: 0.20 },
      countriesByWeek: {},
    });
    expect(score).toBeGreaterThan(15);
  });
  it('falls back to country-count growth when SoV missing', () => {
    const score = computeImpressionMomentum({
      sovByWeek: {},
      countriesByWeek: { w1: 1, w2: 2, w3: 4, w4: 8 },
    });
    expect(score).toBeGreaterThan(10);
  });
  it('prefers SoV over countries when both present', () => {
    const withSov = computeImpressionMomentum({
      sovByWeek: { w1: 0.01, w2: 0.02 },
      countriesByWeek: { w1: 10, w2: 1 },
    });
    expect(withSov).toBeGreaterThan(0);
  });
});
