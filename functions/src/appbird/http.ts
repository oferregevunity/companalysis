import fetch from 'node-fetch';

/**
 * Shared AppBird (appbird.ai) HTTP plumbing. Auth is an `x-api-key` header (NOT
 * Bearer). Split out from `client.ts` so the app/developer endpoints and the
 * X-Ray endpoints share one retry/backoff policy.
 */
export const BASE_URL = 'https://api.appbird.ai/v1';

/**
 * Delay between sequential AppBird calls, set by the account's 60 requests/minute
 * rate limit — 1,100ms paces us at ~54/min with margin.
 *
 * This was 150ms, which is ~400/min: nearly 7x over the limit. That is where the
 * 429s and the failed requests visible on the usage dashboard came from. Failures
 * are not billed, but they burn wall-clock time and trigger the retry path, and a
 * retry that succeeds IS billed — so pacing correctly is cheaper than backing off.
 *
 * Cost of the slowdown is acceptable: a 24-page crawl takes ~26s and a 100-app
 * enrichment sweep ~110s, both well inside the 540s function timeout.
 */
export const REQUEST_DELAY_MS = 1100;

const MAX_RETRIES = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AppBird refused the request for the rest of the billing period — the X-Ray
 * endpoints have their own monthly quota, separate from /apps and /developers.
 * Callers must abort the whole pass on this: retrying, or moving to the next app,
 * only burns more of an allowance that is already gone.
 */
export class AppbirdQuotaError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AppbirdQuotaError';
    this.status = status;
  }
}

/** A 4xx that will not change on retry (unknown id, bad params, rejected key). */
export class PermanentAppbirdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentAppbirdError';
  }
}

/** True when the response says we are out of quota rather than merely throttled. */
function isQuotaExhausted(status: number, body: string): boolean {
  return (status === 403 || status === 402) && /quota|limit exceeded|exceeded your/i.test(body);
}

export interface FetchOptions {
  retries?: number;
  /**
   * Called once per HTTP attempt, before it is made. Lets the caller meter real
   * AppBird consumption — including retries, which also count against quota.
   */
  onAttempt?: (endpoint: string) => void;
}

export async function fetchWithRetry(
  url: string,
  apiKey: string,
  options: FetchOptions | number = {},
): Promise<any> {
  // Number form kept for the original positional `retries` signature.
  const { retries = MAX_RETRIES, onAttempt } = typeof options === 'number' ? { retries: options } : options;
  const endpoint = new URL(url).pathname;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      onAttempt?.(endpoint);
      const response = await fetch(url, { headers: { 'x-api-key': apiKey } });

      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.warn(`AppBird rate limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const detail = `AppBird API error ${response.status}: ${response.statusText} - ${body.slice(0, 300)}`;
        if (isQuotaExhausted(response.status, body)) throw new AppbirdQuotaError(detail, response.status);
        // Other 4xx are permanent for this request (bad id, bad params, bad key):
        // retrying spends quota to get the same answer.
        if (response.status >= 400 && response.status < 500) throw new PermanentAppbirdError(detail);
        throw new Error(detail);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof AppbirdQuotaError || error instanceof PermanentAppbirdError) throw error;
      if (attempt === retries) throw error;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`AppBird request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms...`, error);
      await sleep(backoff);
    }
  }
}

/** Build a `${BASE_URL}/${path}` URL, dropping null/undefined/empty params. */
export function buildUrl(path: string, params: Record<string, string | number | boolean | undefined | null> = {}): string {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}
