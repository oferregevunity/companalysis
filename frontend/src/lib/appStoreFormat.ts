/**
 * Pure presentation helpers for store-listing data (AppBird app details, the
 * ownership-transfers feed). Kept out of components so both surfaces format
 * dates, counts and countries the same way.
 */

/** ISO 3166-1 alpha-2 → flag emoji (regional-indicator pair). '' when unknown. */
export function flagEmoji(cc: string | null | undefined): string {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6;
  const up = cc.toUpperCase();
  if (up < 'AA' || up > 'ZZ') return '';
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

/** "May 1, 2026" — '' for null/unparseable input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "May 1, 2026, 9:31 AM" — for hover titles. '' when unparseable. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Signed relative time: past reads "3 months ago", future reads "in 28 days"
 * (store `updatedAt` can be a scheduled future release). `style: 'short'`
 * compacts units for dense rows ("3mo ago", "in 28d").
 */
export function relativeFromNow(
  iso: string | null | undefined,
  style: 'short' | 'long' = 'long',
): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';

  const deltaSec = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 45) return 'just now';

  const [value, unit] =
    abs < HOUR
      ? [Math.round(abs / MINUTE), 'minute']
      : abs < DAY
        ? [Math.round(abs / HOUR), 'hour']
        : abs < MONTH
          ? [Math.round(abs / DAY), 'day']
          : abs < YEAR
            ? [Math.round(abs / MONTH), 'month']
            : [Math.round(abs / YEAR), 'year'];

  if (style === 'short') {
    const shortUnit = unit === 'minute' ? 'm' : unit === 'hour' ? 'h' : unit === 'day' ? 'd' : unit === 'month' ? 'mo' : 'y';
    return deltaSec < 0 ? `${value}${shortUnit} ago` : `in ${value}${shortUnit}`;
  }

  const plural = `${unit}${value === 1 ? '' : 's'}`;
  return deltaSec < 0 ? `${value} ${plural} ago` : `in ${value} ${plural}`;
}

/** 2_300_749_731 → "2.3B"; 38_917_368 → "38.9M"; 812 → "812". */
export function compactNumber(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trimZero(n / 1e9)}B`;
  if (abs >= 1e6) return `${trimZero(n / 1e6)}M`;
  if (abs >= 1e3) return `${trimZero(n / 1e3)}K`;
  return String(n);
}

function trimZero(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '');
}

/** Thousands-separated integer; "—" when absent. */
export function formatCount(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

/** "Free", or the price in its currency ("$4.99"). */
export function formatPrice(price: number, currency: string | null, free: boolean): string {
  if (free || price === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(price);
  } catch {
    return `${price} ${currency ?? ''}`.trim();
  }
}

/** "GooglePlay" → "Google Play"; "AppStore" → "App Store". */
export function storeLabel(store: string): string {
  if (store === 'GooglePlay') return 'Google Play';
  if (store === 'AppStore') return 'App Store';
  return store;
}

/** "TopGrossing" → "Top Grossing" (AppBird collection names are PascalCase). */
export function collectionLabel(collection: string): string {
  return collection.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Public store URL for a listing. AppBird gives us `storefront.pageUrl` for the
 * fetched app, but linked apps on the other store carry only ids.
 */
export function storeUrl(store: string, storeId: string): string {
  return store === 'GooglePlay'
    ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(storeId)}`
    : `https://apps.apple.com/app/id${encodeURIComponent(storeId)}`;
}
