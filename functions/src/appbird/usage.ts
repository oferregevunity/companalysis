import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Meters AppBird consumption so neither a background job nor interactive browsing
 * can quietly drain the allowance (which is what happened on 2026-08-04).
 *
 * Spend is measured in CREDITS, not requests: a report page costs 150 while an app
 * listing costs 5, so a request count misrepresents cost by up to 30x. Everything
 * draws on ONE pool of 20,000 per period — an earlier version of this file assumed
 * X-Ray had a separate quota, which the usage dashboard disproved.
 *
 * Counting happens in-process during a run — `countAttempt` is wired into the HTTP
 * layer's per-attempt hook, so retries count too — and is flushed to a per-day doc,
 * `appbirdUsage/{YYYY-MM-DD}`. `checkBudget` sums the trailing window and refuses
 * once the self-imposed cap is spent; see USAGE_WINDOW_DAYS for why the window is
 * trailing rather than aligned to AppBird's period.
 *
 * The cap is ours, not AppBird's, and is deliberately below the real ceiling: this
 * meter only sees calls made through these functions, and the account is shared.
 */

const COLLECTION = 'appbirdUsage';

/** Self-imposed monthly ceiling for automated runs. Interactive calls are exempt. */
export const DEFAULT_MONTHLY_BUDGET = 600;

/**
 * AppBird bills per request, but not equally, and everything draws on ONE credit
 * pool — so counting requests badly misrepresents cost. A report page costs 30x an
 * app listing, which is why a 24-page crawl (reported as "24 calls") is ~3,600
 * credits.
 *
 * These are reconciled against AppBird's own usage dashboard, where every line
 * matches exactly once failed requests are excluded (they are not billed):
 *   xray-reports  (128 req − 7 err) × 150 = 18,150
 *   apps/{id}     (225 req − 20 err) × 5  =  1,025
 *   developers/{id}      57 req      × 5  =    285
 *   search        (22 req − 8 err)   × 5  =     70
 *
 * The teardown price is AppBird's published figure; the window above contained no
 * teardown calls, so it is the one entry not yet confirmed against real spend.
 */
export const ENDPOINT_CREDITS: Record<string, number> = {
  'xray-reports': 150,
  'xray-reports/{id}': 500,
  'xray-integrations': 5,
  apps: 5,
  'apps/{id}': 5,
  developers: 5,
  'developers/{id}': 5,
  search: 5,
};

/** Charged when an endpoint is not in the table, so unknown paths still cost something. */
const UNKNOWN_ENDPOINT_CREDITS = 5;

/**
 * The plan's actual allowance per billing period, for reference. Prepaid balance is
 * 0, so there is no buffer once this is gone — requests simply fail.
 */
export const PLAN_MONTHLY_CREDITS = 20000;

/**
 * Self-imposed ceiling for THIS APP, deliberately below the 20,000 the plan allows.
 *
 * The headroom is not caution for its own sake: this meter only sees calls made
 * through these functions, and the account is shared — the usage dashboard shows
 * `/v1/mcp` and `/v1/search` traffic that this codebase never calls. Spending to the
 * real limit would starve those other consumers, and with a prepaid balance of 0
 * there is nothing to absorb the overrun.
 *
 * Steady state for this app is ~2,900 per period (weekly incremental crawl, the
 * popularity sweep, and a quarterly full crawl amortized), so this leaves a wide
 * margin for interactive use as well.
 */
export const DEFAULT_MONTHLY_CREDITS = 14000;

/**
 * What one request to `pathname` costs.
 *
 * Kept separate from `endpointFamily` on purpose: that function intentionally
 * collapses `/v1/xray-reports` and `/v1/xray-reports/{storeId}` into one reporting
 * key, but they cost 150 and 500, so pricing has to look at the id segment.
 */
export function endpointCredits(pathname: string): number {
  const parts = pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('v1');
  const family = idx >= 0 ? parts[idx + 1] : parts[0];
  if (!family) return UNKNOWN_ENDPOINT_CREDITS;
  const hasId = (idx >= 0 ? parts.length - idx - 2 : parts.length - 1) > 0;
  return (
    ENDPOINT_CREDITS[hasId ? `${family}/{id}` : family] ?? ENDPOINT_CREDITS[family] ?? UNKNOWN_ENDPOINT_CREDITS
  );
}

/**
 * Spend is bucketed per DAY and the budget is checked against a trailing window,
 * rather than against a period that tries to mirror AppBird's own.
 *
 * The plan's period nominally runs the 28th to the 28th, but AppBird support can
 * reset the quota mid-cycle on request, so no boundary we hardcode stays true. A
 * trailing window needs no boundary: it is never wrong about *when* the period
 * started, and after an out-of-band reset it errs toward refusing rather than
 * overspending — the right direction when the prepaid balance is 0 and failures are
 * hard stops. A deliberate run can still pass `ignoreMonthlyBudget`.
 *
 * Daily buckets also leave a spend history, which is what was missing when this
 * month's usage came as a surprise.
 */
export const USAGE_WINDOW_DAYS = 30;

/** Firestore doc id for one day of spend, e.g. `2026-08-04`. */
export function usageDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Day keys covering the trailing window ending at `now`, newest first. */
export function usageWindowKeys(now = new Date(), days = USAGE_WINDOW_DAYS): string[] {
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(usageDayKey(d));
  }
  return keys;
}

/** Per-run tally of real HTTP attempts, grouped by endpoint family. */
export class CallMeter {
  private counts = new Map<string, number>();
  private creditTotal = 0;

  /** Wire as `onAttempt` on the HTTP layer. */
  readonly countAttempt = (endpoint: string): void => {
    const family = endpointFamily(endpoint);
    this.counts.set(family, (this.counts.get(family) ?? 0) + 1);
    this.creditTotal += endpointCredits(endpoint);
  };

  get total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  /**
   * Weighted credit spend for this run — the figure that matches AppBird's billing.
   * Counted per attempt, so a retry is charged like the extra request it is; this
   * slightly over-counts, since AppBird does not bill failures.
   */
  get credits(): number {
    return this.creditTotal;
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
    if (this.creditTotal > 0) {
      update.credits = admin.firestore.FieldValue.increment(this.creditTotal);
    }
    for (const [family, n] of this.counts) {
      update[`byEndpoint.${family}`] = admin.firestore.FieldValue.increment(n);
    }
    try {
      await db.collection(COLLECTION).doc(usageDayKey(now)).set(update, { merge: true });
    } catch (err) {
      console.warn('appbirdUsage flush failed:', err);
    }
    this.counts.clear();
    this.creditTotal = 0;
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
  /** Human label for the window measured, e.g. "30 days to 2026-08-04". */
  month: string;
  /** First day counted, inclusive. */
  windowStart: string;
  windowDays: number;
  /** Request count, across every AppBird endpoint. Reporting only. */
  used: number;
  budget: number;
  remaining: number;
  /** True when either ceiling is spent. Credits are the one that matters. */
  exhausted: boolean;
  /** Weighted spend — the figure that matches AppBird's billing. */
  creditsUsed: number;
  creditsBudget: number;
  creditsRemaining: number;
  /** Which ceiling stopped us, so the message can name the real cause. */
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
 * Spend over the trailing window, and how much of the self-imposed budget is left.
 * `budget` can be lowered per call site; automated jobs should pass a share of the
 * total so one job cannot spend everything.
 */
export async function checkBudget(
  db: Firestore,
  opts: { budget?: number; creditsBudget?: number; windowDays?: number; now?: Date } = {},
): Promise<BudgetStatus> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? USAGE_WINDOW_DAYS;
  const dayKeys = usageWindowKeys(now, windowDays);
  const windowStart = dayKeys[dayKeys.length - 1];
  const month = `${windowDays} days to ${usageDayKey(now)}`;
  const budget = opts.budget ?? DEFAULT_MONTHLY_BUDGET;
  const creditsBudget = opts.creditsBudget ?? DEFAULT_MONTHLY_CREDITS;
  let used = 0;
  let creditsUsed = 0;
  try {
    const col = db.collection(COLLECTION);
    const snaps = await db.getAll(...dayKeys.map((k) => col.doc(k)));
    for (const snap of snaps) {
      const data = snap.data();
      if (typeof data?.total === 'number') used += data.total;
      if (typeof data?.credits === 'number') creditsUsed += data.credits;
    }
  } catch (err) {
    // A read failure must not become a reason to spend unmetered.
    console.warn('appbirdUsage read failed, assuming budget spent:', err);
    return {
      month,
      windowStart,
      windowDays,
      used: budget,
      budget,
      remaining: 0,
      exhausted: true,
      creditsUsed: creditsBudget,
      creditsBudget,
      creditsRemaining: 0,
      exhaustedBy: 'credits',
    };
  }
  const callsSpent = used >= budget;
  const creditsSpent = creditsUsed >= creditsBudget;
  return {
    month,
    windowStart,
    windowDays,
    used,
    budget,
    remaining: Math.max(budget - used, 0),
    exhausted: callsSpent || creditsSpent,
    creditsUsed,
    creditsBudget,
    creditsRemaining: Math.max(creditsBudget - creditsUsed, 0),
    exhaustedBy: creditsSpent ? 'credits' : callsSpent ? 'calls' : null,
  };
}

/**
 * Refuse an interactive AppBird request once the month's credits are gone.
 *
 * Automation was gated from the start, but interactive routes were not — which
 * meant browsing could still drain the pool that automation had been carefully kept
 * out of. Throws `AppbirdBudgetError` so routes surface it as a clear 429 rather
 * than a generic failure.
 */
export class AppbirdBudgetError extends Error {
  readonly status = 429;

  constructor(readonly usage: BudgetStatus) {
    super(
      `AppBird monthly credit budget spent for ${usage.month} ` +
        `(${usage.creditsUsed}/${usage.creditsBudget} credits). Cached data still works; ` +
        'new AppBird lookups resume next month, or raise DEFAULT_MONTHLY_CREDITS.',
    );
    this.name = 'AppbirdBudgetError';
  }
}

/** Throw if this month's credits are spent. Cache hits should be checked BEFORE this. */
export async function assertCreditsAvailable(db: Firestore): Promise<BudgetStatus> {
  const usage = await checkBudget(db);
  if (usage.exhaustedBy === 'credits') throw new AppbirdBudgetError(usage);
  return usage;
}
