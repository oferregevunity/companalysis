import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Meters AppBird consumption so a background job can never quietly drain the
 * monthly allowance again (which is what happened on 2026-08-04: X-Ray has its
 * own small monthly quota, separate from /apps and /developers).
 *
 * Counting happens in-process during a run — `countAttempt` is wired into the
 * HTTP layer's per-attempt hook, so retries count too, since they also bill —
 * and is flushed once to `appbirdUsage/{YYYY-MM}` at the end. Before a run
 * starts, `checkBudget` reads that month's total and refuses to start when the
 * self-imposed cap is already spent.
 *
 * The cap is ours, not AppBird's: it exists to keep automation well below the
 * real ceiling so interactive use (a teardown, an app listing) always has room.
 */

const COLLECTION = 'appbirdUsage';

/** Self-imposed monthly ceiling for automated runs. Interactive calls are exempt. */
export const DEFAULT_MONTHLY_BUDGET = 600;

export function usageMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Per-run tally of real HTTP attempts, grouped by endpoint family. */
export class CallMeter {
  private counts = new Map<string, number>();

  /** Wire as `onAttempt` on the HTTP layer. */
  readonly countAttempt = (endpoint: string): void => {
    const family = endpointFamily(endpoint);
    this.counts.set(family, (this.counts.get(family) ?? 0) + 1);
  };

  get total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  byEndpoint(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort((a, b) => b[1] - a[1]));
  }

  /** Add this run's attempts to the month's totals. Never throws. */
  async flush(db: Firestore, now = new Date()): Promise<void> {
    if (this.total === 0) return;
    const update: Record<string, unknown> = {
      total: admin.firestore.FieldValue.increment(this.total),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    for (const [family, n] of this.counts) {
      update[`byEndpoint.${family}`] = admin.firestore.FieldValue.increment(n);
    }
    try {
      await db.collection(COLLECTION).doc(usageMonthKey(now)).set(update, { merge: true });
    } catch (err) {
      console.warn('appbirdUsage flush failed:', err);
    }
    this.counts.clear();
  }
}

/**
 * Collapse a request path to a billable family: `/v1/apps/6758342097` → `apps`,
 * `/v1/xray-reports` → `xray-reports`. Keeps the counter to a handful of keys.
 */
export function endpointFamily(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('v1');
  const family = idx >= 0 ? parts[idx + 1] : parts[0];
  return family ?? 'unknown';
}

export interface BudgetStatus {
  month: string;
  used: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
}

/**
 * Run `fn` with a metering hook and record whatever it spent, even on failure.
 * Interactive routes use this to stay visible in the month's totals without being
 * gated by the automation budget.
 */
export async function withCallMeter<T>(
  db: Firestore,
  fn: (onAttempt: (endpoint: string) => void) => Promise<T>,
): Promise<T> {
  const meter = new CallMeter();
  try {
    return await fn(meter.countAttempt);
  } finally {
    await meter.flush(db);
  }
}

/**
 * How much of this month's self-imposed budget is left. `budget` can be lowered
 * per call site; automated jobs should pass a share of the total so one job
 * cannot spend everything.
 */
export async function checkBudget(
  db: Firestore,
  opts: { budget?: number; now?: Date } = {},
): Promise<BudgetStatus> {
  const month = usageMonthKey(opts.now);
  const budget = opts.budget ?? DEFAULT_MONTHLY_BUDGET;
  let used = 0;
  try {
    const snap = await db.collection(COLLECTION).doc(month).get();
    const total = snap.data()?.total;
    if (typeof total === 'number') used = total;
  } catch (err) {
    // A read failure must not become a reason to spend unmetered.
    console.warn('appbirdUsage read failed, assuming budget spent:', err);
    return { month, used: budget, budget, remaining: 0, exhausted: true };
  }
  return { month, used, budget, remaining: Math.max(budget - used, 0), exhausted: used >= budget };
}
