import { describe, it, expect } from 'vitest';
import { parseRawCreative, parseNetworkShareOfVoice } from './client';
import creativesFixture from './fixtures/creatives_unified.sample.json';
import sovFixture from './fixtures/network_share_of_voice.sample.json';

describe('parseRawCreative', () => {
  it('normalizes a Sensor Tower ad_unit into our RawCreative shape', () => {
    const item = (creativesFixture as any).ad_units[0];
    const parsed = parseRawCreative(item, 'US');

    expect(parsed.id).toBeTypeOf('string');
    expect(parsed.network).toBe('Instagram');
    expect(parsed.country).toBe('US');
    expect(parsed.format).toBe('video');
    expect(parsed.firstSeen).toBe('2024-02-27');
    expect(parsed.lastSeen).toBe('2024-06-04');
    expect(parsed.durationDays).toBeGreaterThan(0);
    expect(parsed.share).toBeCloseTo(0.40158, 5);
    expect(parsed.mediaUrl).toMatch(/^https?:\/\//);
    expect(parsed.previewUrl).toMatch(/^https?:\/\//);
    expect(parsed.thumbnailUrl).toMatch(/^https?:\/\//);
    expect(parsed.phashionGroup).toBeTypeOf('string');
    expect(parsed.variantCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.adFormats)).toBe(true);
    expect(Array.isArray(parsed.breakdown)).toBe(true);
  });

  it('collapses multiple variants into one RawCreative with variantCount > 1', () => {
    const multi = (creativesFixture as any).ad_units.find(
      (u: any) => Array.isArray(u.creatives) && u.creatives.length > 1
    );
    expect(multi).toBeDefined();
    const parsed = parseRawCreative(multi, 'US');
    expect(parsed.variantCount).toBe(multi.creatives.length);
    expect(parsed.mediaUrl).toBe(multi.creatives[0].creative_url);
  });

  it('coerces missing fields to null (never undefined)', () => {
    const parsed = parseRawCreative(
      {
        id: 'abc',
        app_id: '553834731',
        network: 'TikTok',
        phashion_group: null,
        ad_type: 'image',
        first_seen_at: '2026-01-01',
        last_seen_at: '2026-01-05',
        creatives: [],
      },
      'US'
    );
    expect(parsed.mediaUrl).toBeNull();
    expect(parsed.previewUrl).toBeNull();
    expect(parsed.thumbnailUrl).toBeNull();
    expect(parsed.videoDurationSec).toBeNull();
    expect(parsed.width).toBeNull();
    expect(parsed.height).toBeNull();
    expect(parsed.title).toBeNull();
    expect(parsed.message).toBeNull();
    expect(parsed.buttonText).toBeNull();
    expect(parsed.share).toBeNull();
    expect(parsed.phashionGroup).toBeNull();
    expect(parsed.format).toBe('image');
    expect(parsed.variantCount).toBe(0);
  });
});

describe('parseNetworkShareOfVoice', () => {
  it('normalizes a SoV row', () => {
    const row = (sovFixture as any)[0];
    const parsed = parseNetworkShareOfVoice(row, 'week');
    expect(parsed.appId).toBe(row.app_id);
    expect(parsed.network).toBe(row.network);
    expect(parsed.country).toBe(row.country);
    expect(parsed.date).toBe(row.date);
    expect(parsed.period).toBe('week');
    expect(parsed.sov).toBe(row.sov);
  });
});
