import fetch from 'node-fetch';
import { defineSecret } from 'firebase-functions/params';

/**
 * AppBird (appbird.ai) — App Store + Google Play intelligence. We use it for the
 * ownership-transfers feed: which games moved from one developer/publisher to
 * another. Auth is an `x-api-key` header (NOT Bearer). Endpoints are per-store-id.
 */
export const appbirdApiKey = defineSecret('APPBIRD_API_KEY');

const BASE_URL = 'https://api.appbird.ai/v1';
const REQUEST_DELAY_MS = 150;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
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

/** A developer as it appears on either side of a transfer (thin — no country). */
export interface AppbirdTransferDeveloper {
  storeId: string;
  name: string;
  isStarred: boolean | null;
  isPublisher: boolean | null;
}

/** One ownership-transfer record: an app moving from one developer to another. */
export interface AppbirdOwnershipTransfer {
  app: {
    storeId: string;
    name: string;
    iconUrl: string | null;
    store: string; // "GooglePlay" | "AppStore"
  };
  fromDeveloper: AppbirdTransferDeveloper;
  toDeveloper: AppbirdTransferDeveloper;
  detectedAt: string; // ISO date-time
}

/** The primary developer object returned by GET /v1/developers/{id}. */
export interface AppbirdDeveloper {
  storeId: string;
  name: string;
  country: string | null;
  isPublisher: boolean | null;
  isStarred: boolean | null;
  iconUrl: string | null;
}

export interface AppbirdDeveloperResponse {
  developer: AppbirdDeveloper;
  countApps: number | null;
  ownershipTransfers: AppbirdOwnershipTransfer[];
  linkedDevelopers: { storeId: string; name: string; store: string }[];
}

/**
 * GET /v1/developers/{developerStoreId} — 5 credits. Returns the developer plus
 * ALL ownership transfers involving them (both incoming and outgoing). This is
 * the primitive that powers the ownership-transfers feed: iterate a set of
 * tracked publisher developer ids and union their transfers.
 */
export async function getDeveloper(
  developerStoreId: string,
  apiKey: string,
): Promise<AppbirdDeveloperResponse> {
  const url = `${BASE_URL}/developers/${encodeURIComponent(developerStoreId)}`;
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchWithRetry(url, apiKey);
  const dev = data?.developer ?? {};
  return {
    developer: {
      storeId: String(dev.storeId ?? developerStoreId),
      name: dev.name ?? developerStoreId,
      country: dev.country ?? null,
      isPublisher: dev.isPublisher ?? null,
      isStarred: dev.isStarred ?? null,
      iconUrl: dev.iconUrl ?? null,
    },
    countApps: typeof data?.countApps === 'number' ? data.countApps : null,
    ownershipTransfers: Array.isArray(data?.ownershipTransfers)
      ? (data.ownershipTransfers as AppbirdOwnershipTransfer[])
      : [],
    linkedDevelopers: Array.isArray(data?.linkedDevelopers) ? data.linkedDevelopers : [],
  };
}
