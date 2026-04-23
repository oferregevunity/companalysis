import fetch from 'node-fetch';
import type {
  AdNetwork,
  BreakdownBucket,
  CreativeFormat,
  NetworkShareOfVoice,
  QueryableAdNetwork,
  RawCreative,
} from './types';
import { TRACKED_NETWORKS } from './types';

const BASE_URL = 'https://api.sensortower.com/v1';
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 3;

/**
 * Ad types accepted by `/unified/ad_intel/creatives`. The real API rejects
 * `html` (422) and accepts: image, banner, full_screen, image-banner,
 * image-interstitial, image-other, video, video-rewarded, video-interstitial,
 * video-other, playable, interactive-playable, interactive-playable-rewarded,
 * interactive-playable-other. Passing the three broad categories covers all
 * creatives we care about.
 */
const AD_TYPES_ALL = ['video', 'image', 'playable'] as const;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.warn(`[adIntel] 429, backing off ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ad Intel ${res.status}: ${res.statusText} – ${body.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw new Error(`Ad Intel: rate limited (429) after ${retries + 1} attempts`);
}

function daysBetween(a: string, b: string): number {
  const d1 = Date.parse(a);
  const d2 = Date.parse(b);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

function toCreativeFormat(adType: unknown): CreativeFormat {
  const s = String(adType ?? '').toLowerCase();
  if (s.includes('video')) return 'video';
  if (s.includes('playable')) return 'playable';
  if (s.includes('image') || s.includes('banner') || s.includes('html')) return 'image';
  return 'unknown';
}

function parseBreakdown(raw: any): BreakdownBucket[] {
  const dateArr = raw?.date;
  if (!Array.isArray(dateArr)) return [];
  const out: BreakdownBucket[] = [];
  for (const row of dateArr) {
    if (!Array.isArray(row) || row.length !== 2) continue;
    const range = row[0];
    const share = row[1];
    if (!Array.isArray(range) || range.length !== 2) continue;
    out.push({
      start: String(range[0] ?? ''),
      end: String(range[1] ?? ''),
      share: Number(share) || 0,
    });
  }
  return out;
}

export function parseRawCreative(adUnit: any, country: string): RawCreative {
  const firstSeen = String(adUnit.first_seen_at ?? '');
  const lastSeen = String(adUnit.last_seen_at ?? '');
  const variants: any[] = Array.isArray(adUnit.creatives) ? adUnit.creatives : [];
  const primary = variants[0] ?? {};

  return {
    id: String(adUnit.id ?? ''),
    phashionGroup:
      typeof adUnit.phashion_group === 'string' && adUnit.phashion_group.length > 0
        ? adUnit.phashion_group
        : null,
    appId: String(adUnit.app_id ?? ''),
    network: String(adUnit.network ?? '') as QueryableAdNetwork,
    country,
    format: toCreativeFormat(adUnit.ad_type),
    rawAdType: String(adUnit.ad_type ?? ''),
    firstSeen,
    lastSeen,
    durationDays: firstSeen && lastSeen ? daysBetween(firstSeen, lastSeen) : 0,
    share: typeof adUnit.share === 'number' ? adUnit.share : null,
    mediaUrl: primary.creative_url ?? null,
    previewUrl: primary.preview_url ?? null,
    thumbnailUrl: primary.thumb_url ?? null,
    videoDurationSec:
      typeof primary.video_duration === 'number' ? primary.video_duration : null,
    width: typeof primary.width === 'number' ? primary.width : null,
    height: typeof primary.height === 'number' ? primary.height : null,
    title: primary.title ?? null,
    message: primary.message ?? null,
    buttonText: primary.button_text ?? null,
    variantCount: variants.length,
    adFormats: Array.isArray(adUnit.ad_formats) ? adUnit.ad_formats.map(String) : [],
    breakdown: parseBreakdown(adUnit.breakdown),
  };
}

export function parseNetworkShareOfVoice(
  row: any,
  period: 'day' | 'week' | 'month'
): NetworkShareOfVoice {
  return {
    appId: String(row.app_id ?? ''),
    network: String(row.network ?? '') as AdNetwork,
    country: String(row.country ?? ''),
    date: String(row.date ?? ''),
    period,
    sov: Number(row.sov ?? 0),
  };
}

export interface FetchCreativesParams {
  authToken: string;
  /** Unified Sensor Tower app id (from our stored `snapshots/.../apps[].unifiedAppId`). */
  appId: string;
  network: QueryableAdNetwork;
  country: string;
  startDate: string;
  endDate: string;
  limit?: number;
  adTypes?: readonly string[];
}

export async function fetchCreativesForApp(params: FetchCreativesParams): Promise<RawCreative[]> {
  const {
    authToken,
    appId,
    network,
    country,
    startDate,
    endDate,
    limit = 200,
    adTypes = AD_TYPES_ALL,
  } = params;

  const qs = new URLSearchParams({
    auth_token: authToken,
    app_ids: appId,
    networks: network,
    countries: country,
    start_date: startDate,
    end_date: endDate,
    ad_types: adTypes.join(','),
    limit: String(limit),
  });

  const url = `${BASE_URL}/unified/ad_intel/creatives?${qs.toString()}`;
  await sleep(REQUEST_DELAY_MS);
  const data = (await fetchWithRetry(url)) as Record<string, unknown> | null;
  const adUnits: any[] = Array.isArray(data?.ad_units) ? data.ad_units : [];
  return adUnits.map(u => parseRawCreative(u, country));
}

export interface FetchSoVParams {
  authToken: string;
  appId: string;
  country: string;
  startDate: string;
  endDate: string;
  period?: 'day' | 'week' | 'month';
}

export async function fetchNetworkShareOfVoice(
  params: FetchSoVParams
): Promise<NetworkShareOfVoice[]> {
  const {
    authToken,
    appId,
    country,
    startDate,
    endDate,
    period = 'week',
  } = params;

  const qs = new URLSearchParams({
    auth_token: authToken,
    app_ids: appId,
    countries: country,
    start_date: startDate,
    end_date: endDate,
    period,
  });

  const url = `${BASE_URL}/unified/ad_intel/network_analysis?${qs.toString()}`;
  await sleep(REQUEST_DELAY_MS);
  const data = (await fetchWithRetry(url)) as Record<string, unknown> | unknown[] | null;
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return rows.map(r => parseNetworkShareOfVoice(r, period));
}

/** Re-export for convenience at the package boundary. */
export { TRACKED_NETWORKS };
