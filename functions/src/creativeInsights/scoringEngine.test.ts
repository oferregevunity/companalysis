import { describe, it, expect } from 'vitest';
import { computeLongevity, computeNetworkBreadth } from './scoringEngine';
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
