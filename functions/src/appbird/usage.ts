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

/**
 * AppBird does not bill every endpoint the same, so counting requests understates
 * what an X-Ray run actually costs: one report page is 150 and one teardown is 500,
 * while the whole integration vocabulary is 5. A full 24-page crawl is therefore
 * ~3,600 — which a request counter reports as "24".
 *
 * Only the X-Ray family is priced here. `/v1/apps` and `/v1/developers` draw on a
 * DIFFERENT monthly quota (see `AppbirdQuotaError` in `http.ts`), and the per-request
 * price of `/v1/apps` is not confirmed, so those stay on the request-count budget
 * rather than being given an invented weight.
 */
export const XRAY_ENDPOINT_CREDITS: Record<string, number> = {
  'xray-reports': 150,
  'xray-reports/{id}': 500,
  'xray-integrations': 5,
};

/**
 * Self-imposed monthly X-Ray credit ceiling.
 *
 * PLACEHOLDER: AppBird has not told us the real X-Ray allowance, so this is set to
 * roughly five full crawls' worth — enough for the weekly job plus interactive use,
 * low enough that a runaway is stopped. Credits are now recorded accurately per
 * month in `appbirdUsage/{YYYY-MM}.xrayCredits`, so replace this with the real
 * quota once a month of data (or an answer from AppBird) is in.
 */
export const DEFAULT_MONTHLY_XRAY_CREDITS = 20000;

/**
 * What one request to `pathname` costs, or null when the path is not on the X-Ray
 * quota (and so is governed by the request-count budget instead).
 *
 * Kept separate from `endpointFamily` on purpose: that function intentionally
 * collapses `/v1/xray-reports` and `/v1/xray-reports/{storeId}` into one reporting
 * key, but they cost 150 and 500, so pricing has to look at the id segment.
 */
export function endpointCredits(pathname: string): number | null {
  const parts = pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('v1');
  const family = idx >= 0 ? parts[idx + 1] : parts[0];
  if (!family) return null;
  const hasId = (idx >= 0 ? parts.length - idx - 2 : parts.length - 1) > 0;
  return XRAY_ENDPOINT_CREDITS[hasId ? `${family}/{id}` : family] ?? XRAY_ENDPOINT_CREDITS[family] ?? null;
}

export function usageMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Per-run tally of real HTTP attempts, grouped by endpoint family. */
export class CallMeter {
  private counts = new Map<string, number>();
  private credits = 0;

  /** Wire as `onAttempt` on the HTTP layer. */
  readonly countAttempt = (endpoint: string): void => {
    const family = endpointFamily(endpoint);
    this.counts.set(family, (this.counts.get(family) ?? 0) + 1);
    const price = endpointCredits(endpoint);
    if (price !== null) this.credits += price;
  };

  get total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  /** Weighted X-Ray spend for this run. Unpriced endpoints contribute nothing. */
  get xrayCredits(): number {
    return this.credits;
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
    if (this.credits > 0) {
      update.xrayCredits = admin.firestore.FieldValue.increment(this.credits);
    }
    for (const [family, n] of this.counts) {
      update[`byEndpoint.${family}`] = admin.firestore.FieldValue.increment(n);
    }
    try {
      await db.collection(COLLECTION).doc(usageMonthKey(now)).set(update, { merge: true });
    } catch (err) {
      console.warn('appbirdUsage flush failed:', err);
    }
    this.counts.clear();
    this.credits = 0;
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
  /** Request count, across every AppBird endpoint. */
  used: number;
  budget: number;
  remaining: number;
  /** True when EITHER the request-count or the X-Ray credit ceiling is spent. */
  exhausted: boolean;
  /** Weighted X-Ray spend — the number that reflects what a crawl really costs. */
  xrayCreditsUsed: number;
  xrayCreditsBudget: number;
  xrayCreditsRemaining: number;
  /** Which ceiling stopped us, for a message that names the real cause. */
  exhaustedBy: 'calls' | 'credits' | null;
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
  opts: { budget?: number; xrayCreditsBudget?: number; now?: Date } = {},
): Promise<BudgetStatus> {
  const month = usageMonthKey(opts.now);
  const budget = opts.budget ?? DEFAULT_MONTHLY_BUDGET;
  const xrayCreditsBudget = opts.xrayCreditsBudget ?? DEFAULT_MONTHLY_XRAY_CREDITS;
  let used = 0;
  let xrayCreditsUsed = 0;
  try {
    const snap = await db.collection(COLLECTION).doc(month).get();
    const data = snap.data();
    if (typeof data?.total === 'number') used = data.total;
    if (typeof data?.xrayCredits === 'number') xrayCreditsUsed = data.xrayCredits;
  } catch (err) {
    // A read failure must not become a reason to spend unmetered.
    console.warn('appbirdUsage read failed, assuming budget spent:', err);
    return {
      month,
      used: budget,
      budget,
      remaining: 0,
      exhausted: true,
      xrayCreditsUsed: xrayCreditsBudget,
      xrayCreditsBudget,
      xrayCreditsRemaining: 0,
      exhaustedBy: 'calls',
    };
  }
  const callsSpent = used >= budget;
  const creditsSpent = xrayCreditsUsed >= xrayCreditsBudget;
  return {
    month,
    used,
    budget,
    remaining: Math.max(budget - used, 0),
    exhausted: callsSpent || creditsSpent,
    xrayCreditsUsed,
    xrayCreditsBudget,
    xrayCreditsRemaining: Math.max(xrayCreditsBudget - xrayCreditsUsed, 0),
    exhaustedBy: creditsSpent ? 'credits' : callsSpent ? 'calls' : null,
  };
}
