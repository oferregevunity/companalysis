import fetch from 'node-fetch';

/**
 * Shared AppBird (appbird.ai) HTTP plumbing. Auth is an `x-api-key` header (NOT
 * Bearer). Split out from `client.ts` so the app/developer endpoints and the
 * X-Ray endpoints share one retry/backoff policy.
 */
export const BASE_URL = 'https://api.appbird.ai/v1';

/** Politeness delay between sequential AppBird calls. */
export const REQUEST_DELAY_MS = 150;

const MAX_RETRIES = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  apiKey: string,
  retries = MAX_RETRIES,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'x-api-key': apiKey } });
      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.warn(`AppBird rate limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`AppBird API error ${response.status}: ${response.statusText} - ${body.slice(0, 300)}`);
      }
      return await response.json();
    } catch (error) {
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
