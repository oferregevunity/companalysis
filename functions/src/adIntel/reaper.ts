import { getFirestore } from 'firebase-admin/firestore';

/**
 * Rolling retention window for the `creativeLatest` index. Anything whose
 * last-seen date is older than this is considered retired from active
 * scraping and safe to drop. Historical `creativeSnapshots/{week}/creatives`
 * docs are NOT deleted — only the hot index.
 */
const DEFAULT_THRESHOLD_DAYS = 60;

interface StaleRow {
  id: string;
  lastSeen: string | null | undefined;
}

/**
 * Pure helper: given an array of `{ id, lastSeen }` rows, returns the subset
 * whose `lastSeen` is strictly older than `now - thresholdDays`. Rows with
 * missing/unparseable `lastSeen` are skipped (conservative default — a
 * corrupted row is left in place until manual cleanup).
 */
export function selectStaleCreatives<T extends StaleRow>(
  rows: T[],
  now: Date,
  thresholdDays: number,
): T[] {
  const cutoff = now.getTime() - thresholdDays * 86400000;
  return rows.filter(r => {
    if (!r.lastSeen) return false;
    const ts = Date.parse(r.lastSeen);
    return Number.isFinite(ts) && ts < cutoff;
  });
}

/**
 * Deletes every `creativeLatest` document whose `lastSeen` is older than
 * `thresholdDays`. Returns the number of deletions.
 */
export async function reapStaleCreatives(
  thresholdDays: number = DEFAULT_THRESHOLD_DAYS,
): Promise<number> {
  const db = getFirestore('companalysis');
  const snap = await db.collection('creativeLatest').get();
  const rows = snap.docs.map(d => ({
    id: d.id,
    ref: d.ref,
    lastSeen: (d.data().lastSeen as string | undefined) ?? null,
  }));
  const stale = selectStaleCreatives(rows, new Date(), thresholdDays);

  const BATCH = 400;
  for (let i = 0; i < stale.length; i += BATCH) {
    const chunk = stale.slice(i, i + BATCH);
    const batch = db.batch();
    for (const row of chunk) {
      batch.delete(row.ref);
    }
    await batch.commit();
  }
  return stale.length;
}
