import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { getDeveloper } from './client';
import { trackedDevelopers } from './publishers';

/** A single ownership-transfer row as stored/served for the feed. */
export interface FeedTransfer {
  key: string;
  app: { storeId: string; name: string; iconUrl: string | null; store: string };
  from: { storeId: string; name: string; isPublisher: boolean | null; isStarred: boolean | null; country: string | null };
  to: { storeId: string; name: string; isPublisher: boolean | null; isStarred: boolean | null; country: string | null };
  detectedAt: string; // ISO
  /** Tracked publisher labels that surfaced this transfer (usually one). */
  trackedPublishers: string[];
}

export interface AggregateResult {
  transfers: FeedTransfer[];
  developersFetched: number;
  errors: string[];
}

function transferKey(store: string, appStoreId: string, detectedAt: string, fromId: string, toId: string): string {
  return `${store}|${appStoreId}|${detectedAt}|${fromId}->${toId}`;
}

/**
 * Fetch every tracked publisher developer, union their ownership transfers,
 * dedupe (the same transfer surfaces on both sides when both parties are
 * tracked), enrich each side's country from what we know about tracked
 * developers, and sort newest-first. Pure — no Firestore — so it's reusable by
 * the standalone verify script and unit tests.
 */
export async function aggregateTransfers(apiKey: string): Promise<AggregateResult> {
  const devs = trackedDevelopers();

  // storeId -> country, for flag enrichment on either side of a transfer.
  const countryByDev = new Map<string, string | null>();
  for (const d of devs) {
    if (d.country) countryByDev.set(d.storeId, d.country);
  }

  const byKey = new Map<string, FeedTransfer>();
  const errors: string[] = [];
  let developersFetched = 0;

  for (const d of devs) {
    try {
      const res = await getDeveloper(d.storeId, apiKey);
      developersFetched++;
      // The fetched developer's own country is authoritative for its storeId.
      if (res.developer.country) countryByDev.set(res.developer.storeId, res.developer.country);

      for (const t of res.ownershipTransfers) {
        if (!t.app?.storeId || !t.detectedAt || !t.fromDeveloper?.storeId || !t.toDeveloper?.storeId) continue;
        const key = transferKey(t.app.store, t.app.storeId, t.detectedAt, t.fromDeveloper.storeId, t.toDeveloper.storeId);
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.trackedPublishers.includes(d.publisherLabel)) existing.trackedPublishers.push(d.publisherLabel);
          continue;
        }
        byKey.set(key, {
          key,
          app: {
            storeId: t.app.storeId,
            name: t.app.name ?? t.app.storeId,
            iconUrl: t.app.iconUrl ?? null,
            store: t.app.store,
          },
          from: {
            storeId: t.fromDeveloper.storeId,
            name: t.fromDeveloper.name ?? t.fromDeveloper.storeId,
            isPublisher: t.fromDeveloper.isPublisher ?? null,
            isStarred: t.fromDeveloper.isStarred ?? null,
            country: countryByDev.get(t.fromDeveloper.storeId) ?? null,
          },
          to: {
            storeId: t.toDeveloper.storeId,
            name: t.toDeveloper.name ?? t.toDeveloper.storeId,
            isPublisher: t.toDeveloper.isPublisher ?? null,
            isStarred: t.toDeveloper.isStarred ?? null,
            country: countryByDev.get(t.toDeveloper.storeId) ?? null,
          },
          detectedAt: t.detectedAt,
          trackedPublishers: [d.publisherLabel],
        });
      }
    } catch (err) {
      errors.push(`${d.publisherLabel} (${d.store} ${d.storeId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A tracked developer fetched AFTER a transfer was first seen may now supply a
  // country for the other side — backfill from the final countryByDev map.
  const transfers = [...byKey.values()].map((t) => ({
    ...t,
    from: { ...t.from, country: t.from.country ?? countryByDev.get(t.from.storeId) ?? null },
    to: { ...t.to, country: t.to.country ?? countryByDev.get(t.to.storeId) ?? null },
  }));

  transfers.sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : a.detectedAt > b.detectedAt ? -1 : 0));

  return { transfers, developersFetched, errors };
}

/**
 * Run the aggregation and upsert every transfer into the `ownershipTransfers`
 * Firestore collection (deterministic doc id → idempotent re-runs). Clients read
 * this collection directly. Called by the manual `ownershipTransfers/run` route
 * and the weekly scheduled job.
 */
export async function runOwnershipTransfers(
  db: Firestore,
  apiKey: string,
): Promise<{ developersFetched: number; transfers: number; written: number; errors: string[] }> {
  const { transfers, developersFetched, errors } = await aggregateTransfers(apiKey);

  const col = db.collection('ownershipTransfers');
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const t of transfers.slice(i, i + BATCH_SIZE)) {
      const id = createHash('sha1').update(t.key).digest('hex').slice(0, 24);
      batch.set(col.doc(id), {
        ...t,
        detectedAtTs: admin.firestore.Timestamp.fromDate(new Date(t.detectedAt)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      written++;
    }
    await batch.commit();
  }

  console.log(`ownershipTransfers: fetched ${developersFetched} developers, wrote ${written} transfers, ${errors.length} errors`);
  return { developersFetched, transfers: transfers.length, written, errors };
}
