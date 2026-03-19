# AI Rising Stars Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI-powered Rising Stars detection system that scores games using statistical signals and generates natural-language insights via Gemini.

**Architecture:** A Cloud Function scoring engine computes a composite Rising Star Score (0-100) per game from 4 sub-scores. Top 5 per genre are sent to Gemini (via `@google-cloud/vertexai`) for natural-language insight generation. Results are stored in Firestore `insights` collection. A new `/insights` frontend page displays the results, and an "AI Score" column is added to the existing Dashboard table.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript), `@google-cloud/vertexai` (Gemini), Firestore, React + TanStack Table + Tailwind CSS, Vitest (new), Recharts (new for sparklines).

---

### Task 1: Set Up Vitest for Cloud Functions

**Files:**
- Create: `functions/vitest.config.ts`
- Modify: `functions/package.json`
- Create: `functions/src/__tests__/setup.ts`

**Step 1: Install Vitest**

Run: `cd functions && npm install --save-dev vitest`

**Step 2: Create Vitest config**

Create `functions/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 3: Add test script to package.json**

In `functions/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Create a smoke test to verify setup**

Create `functions/src/__tests__/setup.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('test setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 5: Run test to verify setup works**

Run: `cd functions && npm test`
Expected: 1 test passes

**Step 6: Commit**

```bash
git add functions/vitest.config.ts functions/package.json functions/package-lock.json functions/src/__tests__/setup.ts
git commit -m "chore: add Vitest testing framework to Cloud Functions"
```

---

### Task 2: Scoring Engine — Revenue Acceleration Sub-Score

**Files:**
- Create: `functions/src/insights/scoringEngine.ts`
- Create: `functions/src/insights/scoringEngine.test.ts`

**Step 1: Write the failing test**

Create `functions/src/insights/scoringEngine.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeRevenueAcceleration } from './scoringEngine';

describe('computeRevenueAcceleration', () => {
  it('returns 0 for empty or single-period data', () => {
    expect(computeRevenueAcceleration({})).toBe(0);
    expect(computeRevenueAcceleration({ '2025-01': 100 })).toBe(0);
  });

  it('returns high score for accelerating growth', () => {
    // Revenue growing faster each period: +50%, +100%, +150%
    const revenue = {
      '2025-01': 1000,
      '2025-02': 1500,
      '2025-03': 3000,
      '2025-04': 7500,
    };
    const score = computeRevenueAcceleration(revenue);
    expect(score).toBeGreaterThan(18); // strong acceleration
    expect(score).toBeLessThanOrEqual(25);
  });

  it('returns moderate score for steady growth', () => {
    // Steady +20% each period
    const revenue = {
      '2025-01': 1000,
      '2025-02': 1200,
      '2025-03': 1440,
      '2025-04': 1728,
    };
    const score = computeRevenueAcceleration(revenue);
    expect(score).toBeGreaterThan(5);
    expect(score).toBeLessThan(15);
  });

  it('returns 0 for declining revenue', () => {
    const revenue = {
      '2025-01': 1000,
      '2025-02': 800,
      '2025-03': 600,
      '2025-04': 400,
    };
    const score = computeRevenueAcceleration(revenue);
    expect(score).toBe(0);
  });

  it('returns low score for decelerating growth', () => {
    // Growth slowing down: +100%, +50%, +10%
    const revenue = {
      '2025-01': 1000,
      '2025-02': 2000,
      '2025-03': 3000,
      '2025-04': 3300,
    };
    const score = computeRevenueAcceleration(revenue);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `functions/src/insights/scoringEngine.ts`:
```ts
/**
 * Compute percent changes between consecutive sorted periods.
 * Returns array of { period, pctChange } for periods that have a predecessor.
 */
function percentChanges(
  valuesByPeriod: Record<string, number>
): { period: string; pctChange: number }[] {
  const sorted = Object.keys(valuesByPeriod).sort();
  const changes: { period: string; pctChange: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = valuesByPeriod[sorted[i - 1]];
    const curr = valuesByPeriod[sorted[i]];
    if (prev > 0) {
      changes.push({ period: sorted[i], pctChange: ((curr - prev) / prev) * 100 });
    } else if (curr > 0) {
      changes.push({ period: sorted[i], pctChange: 100 });
    }
  }
  return changes;
}

/**
 * Weighted moving average of percent changes, recent periods weighted more.
 * Then normalized to 0-25 based on acceleration (are the changes increasing?).
 */
export function computeRevenueAcceleration(
  revenueByPeriod: Record<string, number>
): number {
  const changes = percentChanges(revenueByPeriod);
  if (changes.length === 0) return 0;

  // Weight recent periods more: weights [1, 2, 3, ...] for oldest to newest
  const weights = changes.map((_, i) => i + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedAvg = changes.reduce(
    (sum, c, i) => sum + c.pctChange * weights[i], 0
  ) / totalWeight;

  // If weighted average is negative or zero, no acceleration
  if (weightedAvg <= 0) return 0;

  // Acceleration bonus: are the changes themselves increasing?
  let accelerationBonus = 0;
  if (changes.length >= 2) {
    let accelerating = 0;
    for (let i = 1; i < changes.length; i++) {
      if (changes[i].pctChange > changes[i - 1].pctChange) accelerating++;
    }
    accelerationBonus = (accelerating / (changes.length - 1)) * 10;
  }

  // Combine: base score from weighted average + acceleration bonus
  // Cap weighted average contribution at 15 (150%+ growth is max)
  const baseScore = Math.min(weightedAvg / 10, 15);
  const raw = baseScore + accelerationBonus;
  return Math.min(Math.round(raw * 10) / 10, 25);
}
```

**Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add functions/src/insights/scoringEngine.ts functions/src/insights/scoringEngine.test.ts
git commit -m "feat: add revenue acceleration sub-score (0-25) for Rising Star scoring"
```

---

### Task 3: Scoring Engine — Download Momentum Sub-Score

**Files:**
- Modify: `functions/src/insights/scoringEngine.ts`
- Modify: `functions/src/insights/scoringEngine.test.ts`

**Step 1: Write the failing test**

Append to `functions/src/insights/scoringEngine.test.ts`:
```ts
import { computeDownloadMomentum } from './scoringEngine';

describe('computeDownloadMomentum', () => {
  it('returns 0 for empty data', () => {
    expect(computeDownloadMomentum({})).toBe(0);
  });

  it('returns high score for strong download growth', () => {
    const downloads = {
      '2025-01': 10000,
      '2025-02': 20000,
      '2025-03': 50000,
      '2025-04': 120000,
    };
    const score = computeDownloadMomentum(downloads);
    expect(score).toBeGreaterThan(18);
    expect(score).toBeLessThanOrEqual(25);
  });

  it('returns 0 for declining downloads', () => {
    const downloads = {
      '2025-01': 100000,
      '2025-02': 80000,
      '2025-03': 50000,
    };
    expect(computeDownloadMomentum(downloads)).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: FAIL — `computeDownloadMomentum` not exported

**Step 3: Write minimal implementation**

Add to `functions/src/insights/scoringEngine.ts`:
```ts
/**
 * Download momentum: same algorithm as revenue acceleration, applied to downloads.
 * Normalized to 0-25.
 */
export function computeDownloadMomentum(
  downloadsByPeriod: Record<string, number>
): number {
  // Reuse the same weighted moving average + acceleration logic
  return computeRevenueAcceleration(downloadsByPeriod);
}
```

Note: Since the algorithm is identical (weighted MoM% with acceleration bonus), we reuse the same function. If download-specific tuning is needed later, this can diverge.

**Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add functions/src/insights/scoringEngine.ts functions/src/insights/scoringEngine.test.ts
git commit -m "feat: add download momentum sub-score for Rising Star scoring"
```

---

### Task 4: Scoring Engine — Anomaly Score

**Files:**
- Modify: `functions/src/insights/scoringEngine.ts`
- Modify: `functions/src/insights/scoringEngine.test.ts`

**Step 1: Write the failing test**

Append to test file:
```ts
import { computeAnomalyScore } from './scoringEngine';

describe('computeAnomalyScore', () => {
  it('returns 0 for no data or single period', () => {
    expect(computeAnomalyScore({}, {})).toBe(0);
  });

  it('returns high score for sudden revenue spike', () => {
    // Flat for months, then a 5x spike
    const revenue = {
      '2025-01': 1000, '2025-02': 1100, '2025-03': 900,
      '2025-04': 1050, '2025-05': 950, '2025-06': 5000,
    };
    const downloads = {
      '2025-01': 5000, '2025-02': 5100, '2025-03': 4900,
      '2025-04': 5000, '2025-05': 5050, '2025-06': 25000,
    };
    const score = computeAnomalyScore(revenue, downloads);
    expect(score).toBeGreaterThan(18);
    expect(score).toBeLessThanOrEqual(25);
  });

  it('returns low score for steady values', () => {
    const revenue = {
      '2025-01': 1000, '2025-02': 1020, '2025-03': 980,
      '2025-04': 1010, '2025-05': 990, '2025-06': 1005,
    };
    const downloads = {
      '2025-01': 5000, '2025-02': 5100, '2025-03': 4900,
      '2025-04': 5000, '2025-05': 5050, '2025-06': 5020,
    };
    const score = computeAnomalyScore(revenue, downloads);
    expect(score).toBeLessThan(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: FAIL — `computeAnomalyScore` not exported

**Step 3: Write minimal implementation**

Add to `functions/src/insights/scoringEngine.ts`:
```ts
/**
 * Z-score based anomaly detection for the latest period.
 * Compares the latest value against the historical mean and stddev.
 * Combines revenue and download z-scores (max of the two).
 * Normalized to 0-25.
 */
export function computeAnomalyScore(
  revenueByPeriod: Record<string, number>,
  downloadsByPeriod: Record<string, number>
): number {
  const zScore = (values: Record<string, number>): number => {
    const sorted = Object.keys(values).sort();
    if (sorted.length < 3) return 0; // need history to detect anomaly

    const history = sorted.slice(0, -1).map(k => values[k]);
    const latest = values[sorted[sorted.length - 1]];

    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((sum, v) => sum + (v - mean) ** 2, 0) / history.length;
    const stddev = Math.sqrt(variance);

    if (stddev === 0) return latest > mean ? 3 : 0;
    return (latest - mean) / stddev;
  };

  const revZ = zScore(revenueByPeriod);
  const dlZ = zScore(downloadsByPeriod);

  // Take the max z-score (either metric spiking counts)
  const maxZ = Math.max(revZ, dlZ, 0);

  // Normalize: z=0 -> 0, z=1 -> 8, z=2 -> 16, z=3+ -> 25
  const normalized = Math.min((maxZ / 3) * 25, 25);
  return Math.round(normalized * 10) / 10;
}
```

**Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add functions/src/insights/scoringEngine.ts functions/src/insights/scoringEngine.test.ts
git commit -m "feat: add anomaly detection sub-score for Rising Star scoring"
```

---

### Task 5: Scoring Engine — Cross-Metric Convergence Sub-Score

**Files:**
- Modify: `functions/src/insights/scoringEngine.ts`
- Modify: `functions/src/insights/scoringEngine.test.ts`

**Step 1: Write the failing test**

Append to test file:
```ts
import { computeConvergence } from './scoringEngine';

describe('computeConvergence', () => {
  it('returns 0 for empty data', () => {
    expect(computeConvergence({}, {})).toBe(0);
  });

  it('returns high score when both metrics rise together', () => {
    const revenue = { '2025-01': 1000, '2025-02': 1500, '2025-03': 2200 };
    const downloads = { '2025-01': 10000, '2025-02': 15000, '2025-03': 22000 };
    const score = computeConvergence(revenue, downloads);
    expect(score).toBeGreaterThan(18);
    expect(score).toBeLessThanOrEqual(25);
  });

  it('returns low score when only revenue rises', () => {
    const revenue = { '2025-01': 1000, '2025-02': 1500, '2025-03': 2200 };
    const downloads = { '2025-01': 10000, '2025-02': 9500, '2025-03': 9000 };
    const score = computeConvergence(revenue, downloads);
    expect(score).toBeLessThan(10);
  });

  it('returns 0 when both metrics decline', () => {
    const revenue = { '2025-01': 2000, '2025-02': 1500, '2025-03': 1000 };
    const downloads = { '2025-01': 20000, '2025-02': 15000, '2025-03': 10000 };
    const score = computeConvergence(revenue, downloads);
    expect(score).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: FAIL — `computeConvergence` not exported

**Step 3: Write minimal implementation**

Add to `functions/src/insights/scoringEngine.ts`:
```ts
/**
 * Cross-metric convergence: rewards when both revenue and downloads
 * are trending in the same positive direction.
 * Normalized to 0-25.
 */
export function computeConvergence(
  revenueByPeriod: Record<string, number>,
  downloadsByPeriod: Record<string, number>
): number {
  const revChanges = percentChanges(revenueByPeriod);
  const dlChanges = percentChanges(downloadsByPeriod);

  if (revChanges.length === 0 || dlChanges.length === 0) return 0;

  // Match periods between the two metrics
  const dlMap = new Map(dlChanges.map(c => [c.period, c.pctChange]));

  let convergenceScore = 0;
  let matchedPeriods = 0;

  for (const rc of revChanges) {
    const dlPct = dlMap.get(rc.period);
    if (dlPct === undefined) continue;
    matchedPeriods++;

    if (rc.pctChange > 0 && dlPct > 0) {
      // Both positive: strong signal. Score based on geometric mean of the two.
      const combined = Math.sqrt(rc.pctChange * dlPct);
      convergenceScore += Math.min(combined / 10, 5); // cap per-period contribution
    } else if (rc.pctChange > 0 || dlPct > 0) {
      // Only one positive: weak signal
      convergenceScore += 0.5;
    }
    // Both negative: no contribution
  }

  if (matchedPeriods === 0) return 0;

  // Average over periods, then scale to 0-25
  const avgPerPeriod = convergenceScore / matchedPeriods;
  const normalized = Math.min(avgPerPeriod * 5, 25);
  return Math.round(normalized * 10) / 10;
}
```

**Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add functions/src/insights/scoringEngine.ts functions/src/insights/scoringEngine.test.ts
git commit -m "feat: add cross-metric convergence sub-score for Rising Star scoring"
```

---

### Task 6: Scoring Engine — Composite Score & Top N Selection

**Files:**
- Modify: `functions/src/insights/scoringEngine.ts`
- Modify: `functions/src/insights/scoringEngine.test.ts`

**Step 1: Write the failing test**

Append to test file:
```ts
import { computeRisingStarScore, selectTopRisingStars } from './scoringEngine';
import type { AppScoreInput, ScoredApp } from './scoringEngine';

describe('computeRisingStarScore', () => {
  it('combines all 4 sub-scores into 0-100', () => {
    const app: AppScoreInput = {
      appId: 'test-app',
      appName: 'Test Game',
      publisherName: 'Test Publisher',
      revenueByPeriod: {
        '2025-01': 1000, '2025-02': 1500,
        '2025-03': 3000, '2025-04': 7500,
      },
      downloadsByPeriod: {
        '2025-01': 10000, '2025-02': 15000,
        '2025-03': 30000, '2025-04': 75000,
      },
    };
    const result = computeRisingStarScore(app);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.subScores.revenueAcceleration).toBeGreaterThanOrEqual(0);
    expect(result.subScores.revenueAcceleration).toBeLessThanOrEqual(25);
    expect(result.subScores.downloadMomentum).toBeGreaterThanOrEqual(0);
    expect(result.subScores.downloadMomentum).toBeLessThanOrEqual(25);
    expect(result.subScores.anomalyScore).toBeGreaterThanOrEqual(0);
    expect(result.subScores.anomalyScore).toBeLessThanOrEqual(25);
    expect(result.subScores.crossMetricConvergence).toBeGreaterThanOrEqual(0);
    expect(result.subScores.crossMetricConvergence).toBeLessThanOrEqual(25);
  });
});

describe('selectTopRisingStars', () => {
  it('returns top N apps sorted by score descending', () => {
    const apps: AppScoreInput[] = Array.from({ length: 10 }, (_, i) => ({
      appId: `app-${i}`,
      appName: `Game ${i}`,
      publisherName: `Publisher ${i}`,
      revenueByPeriod: { '2025-01': 1000 * (i + 1), '2025-02': 1500 * (i + 1) },
      downloadsByPeriod: { '2025-01': 10000 * (i + 1), '2025-02': 15000 * (i + 1) },
    }));
    const top5 = selectTopRisingStars(apps, 5);
    expect(top5).toHaveLength(5);
    // Should be sorted descending by score
    for (let i = 1; i < top5.length; i++) {
      expect(top5[i - 1].score).toBeGreaterThanOrEqual(top5[i].score);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: FAIL — types and functions not exported

**Step 3: Write minimal implementation**

Add types and functions to `functions/src/insights/scoringEngine.ts`:
```ts
export interface AppScoreInput {
  appId: string;
  appName: string;
  publisherName: string;
  revenueByPeriod: Record<string, number>;
  downloadsByPeriod: Record<string, number>;
}

export interface SubScores {
  revenueAcceleration: number;
  downloadMomentum: number;
  anomalyScore: number;
  crossMetricConvergence: number;
}

export interface ScoredApp {
  appId: string;
  appName: string;
  publisherName: string;
  score: number;
  subScores: SubScores;
}

export function computeRisingStarScore(app: AppScoreInput): ScoredApp {
  const revAccel = computeRevenueAcceleration(app.revenueByPeriod);
  const dlMomentum = computeDownloadMomentum(app.downloadsByPeriod);
  const anomaly = computeAnomalyScore(app.revenueByPeriod, app.downloadsByPeriod);
  const convergence = computeConvergence(app.revenueByPeriod, app.downloadsByPeriod);

  return {
    appId: app.appId,
    appName: app.appName,
    publisherName: app.publisherName,
    score: Math.round((revAccel + dlMomentum + anomaly + convergence) * 10) / 10,
    subScores: {
      revenueAcceleration: revAccel,
      downloadMomentum: dlMomentum,
      anomalyScore: anomaly,
      crossMetricConvergence: convergence,
    },
  };
}

export function selectTopRisingStars(
  apps: AppScoreInput[],
  topN: number = 5
): ScoredApp[] {
  const scored = apps.map(computeRisingStarScore);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
```

**Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/insights/scoringEngine.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add functions/src/insights/scoringEngine.ts functions/src/insights/scoringEngine.test.ts
git commit -m "feat: add composite Rising Star Score and top-N selection"
```

---

### Task 7: Gemini Integration — Install & Create Client

**Files:**
- Modify: `functions/package.json`
- Create: `functions/src/insights/geminiClient.ts`

**Step 1: Install Vertex AI SDK**

Run: `cd functions && npm install @google-cloud/vertexai`

**Step 2: Create Gemini client module**

Create `functions/src/insights/geminiClient.ts`:
```ts
import { VertexAI } from '@google-cloud/vertexai';
import type { ScoredApp } from './scoringEngine';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = 'us-central1';

function getModel() {
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

export interface GenreInsight {
  summary: string;
  games: Array<{
    appId: string;
    appName: string;
    publisherName: string;
    rank: number;
    score: number;
    subScores: ScoredApp['subScores'];
    explanation: string;
  }>;
  watchList: Array<{
    appId: string;
    appName: string;
    publisherName: string;
    score: number;
    reason: string;
  }>;
}

export async function generateGenreInsights(
  genreName: string,
  topApps: ScoredApp[],
  watchCandidates: ScoredApp[],
  periodData: Record<string, Record<string, { revenue: number; downloads: number }>>
): Promise<GenreInsight> {
  const model = getModel();

  const appSummaries = topApps.map((app, i) => {
    const periods = periodData[app.appId] || {};
    const periodLines = Object.entries(periods)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, d]) => `  ${p}: revenue=$${d.revenue.toLocaleString()}, downloads=${d.downloads.toLocaleString()}`)
      .join('\n');

    return `#${i + 1} ${app.appName} (by ${app.publisherName})
  Rising Star Score: ${app.score}/100
  Sub-scores: Revenue Accel=${app.subScores.revenueAcceleration}/25, Download Momentum=${app.subScores.downloadMomentum}/25, Anomaly=${app.subScores.anomalyScore}/25, Convergence=${app.subScores.crossMetricConvergence}/25
  Period data:
${periodLines}`;
  }).join('\n\n');

  const watchSummaries = watchCandidates.map(app =>
    `- ${app.appName} (score: ${app.score})`
  ).join('\n');

  const prompt = `You are a mobile gaming market analyst. Analyze the following top rising star games in the "${genreName}" genre.

TOP 5 RISING STARS:
${appSummaries}

WATCH LIST CANDIDATES (just outside top 5):
${watchSummaries}

Respond in valid JSON with this exact structure (no markdown, no code fences):
{
  "summary": "2-3 sentence genre trend summary",
  "games": [
    {
      "rank": 1,
      "appId": "the-app-id",
      "explanation": "2-3 sentences explaining why this game is rising"
    }
  ],
  "watchList": [
    {
      "appId": "the-app-id",
      "reason": "1 sentence why this game is worth watching"
    }
  ]
}

For each game explanation, reference specific data points (% changes, revenue figures, download trends). Be concise and analytical. Focus on what the numbers suggest about the game's trajectory.`;

  const result = await model.generateContent(prompt);
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  // Parse the JSON response, stripping any markdown fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  // Merge Gemini's explanations with our scored data
  return {
    summary: parsed.summary || '',
    games: topApps.map((app, i) => {
      const geminiGame = parsed.games?.find(
        (g: { appId?: string; rank?: number }) => g.appId === app.appId || g.rank === i + 1
      );
      return {
        appId: app.appId,
        appName: app.appName,
        publisherName: app.publisherName,
        rank: i + 1,
        score: app.score,
        subScores: app.subScores,
        explanation: geminiGame?.explanation || 'No analysis available.',
      };
    }),
    watchList: watchCandidates.slice(0, 2).map(app => {
      const geminiWatch = parsed.watchList?.find(
        (w: { appId?: string }) => w.appId === app.appId
      );
      return {
        appId: app.appId,
        appName: app.appName,
        publisherName: app.publisherName,
        score: app.score,
        reason: geminiWatch?.reason || 'Score approaching top 5 threshold.',
      };
    }),
  };
}
```

**Step 3: Commit**

```bash
git add functions/src/insights/geminiClient.ts functions/package.json functions/package-lock.json
git commit -m "feat: add Gemini client for Rising Star insight generation"
```

---

### Task 8: Insights Pipeline — Cloud Function Route

**Files:**
- Create: `functions/src/insights/pipeline.ts`
- Modify: `functions/src/index.ts`

**Step 1: Create the pipeline orchestrator**

This function reads snapshot data from Firestore, runs the scoring engine, calls Gemini, and stores results.

Create `functions/src/insights/pipeline.ts`:
```ts
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { selectTopRisingStars, computeRisingStarScore } from './scoringEngine';
import type { AppScoreInput, ScoredApp } from './scoringEngine';
import { generateGenreInsights } from './geminiClient';

const db = getFirestore('companalysis');

interface GenreConfig {
  id: string;
  name: string;
}

/**
 * Load app data from snapshot subcollections for a genre across multiple periods.
 * Returns apps with their revenue and downloads keyed by period.
 */
async function loadGenreAppData(
  genreId: string,
  granularity: 'month' | 'week'
): Promise<{ apps: AppScoreInput[]; periods: string[] }> {
  // Get all snapshots for this genre, sorted by period
  const timeField = granularity === 'week' ? 'week' : 'month';
  let query = db.collection('snapshots')
    .where('genreId', '==', genreId)
    .orderBy(timeField, 'asc');

  if (granularity === 'week') {
    query = query.where('granularity', '==', 'week');
  }

  const snapshotDocs = await query.get();
  const periods: string[] = [];
  const appDataMap = new Map<string, {
    appName: string;
    publisherName: string;
    revenueByPeriod: Record<string, number>;
    downloadsByPeriod: Record<string, number>;
  }>();

  for (const snapDoc of snapshotDocs.docs) {
    const period = snapDoc.data()[timeField] as string;
    if (!period) continue;
    periods.push(period);

    const appsDocs = await snapDoc.ref.collection('apps').get();
    for (const appDoc of appsDocs.docs) {
      const data = appDoc.data();
      const appId = data.unifiedAppId || appDoc.id;

      if (!appDataMap.has(appId)) {
        appDataMap.set(appId, {
          appName: data.unifiedAppName || 'Unknown',
          publisherName: data.publisherName || 'Unknown',
          revenueByPeriod: {},
          downloadsByPeriod: {},
        });
      }

      const entry = appDataMap.get(appId)!;
      entry.revenueByPeriod[period] = data.storeRevenue || 0;
      entry.downloadsByPeriod[period] = data.downloads || 0;
    }
  }

  const apps: AppScoreInput[] = Array.from(appDataMap.entries()).map(
    ([appId, data]) => ({
      appId,
      appName: data.appName,
      publisherName: data.publisherName,
      revenueByPeriod: data.revenueByPeriod,
      downloadsByPeriod: data.downloadsByPeriod,
    })
  );

  return { apps, periods };
}

/**
 * Run the full insights pipeline for a single genre:
 * 1. Load data from Firestore
 * 2. Score all apps
 * 3. Generate Gemini insights for top 5
 * 4. Store results back to Firestore
 */
export async function runInsightsPipeline(
  genre: GenreConfig,
  granularity: 'month' | 'week' = 'month'
): Promise<{ scored: number; topApps: ScoredApp[] }> {
  const { apps, periods } = await loadGenreAppData(genre.id, granularity);

  if (apps.length === 0 || periods.length < 2) {
    return { scored: 0, topApps: [] };
  }

  // Score all apps
  const allScored = apps.map(computeRisingStarScore);
  allScored.sort((a, b) => b.score - a.score);

  const topApps = allScored.slice(0, 5);
  const watchCandidates = allScored.slice(5, 10);

  // Build period data for Gemini context
  const periodData: Record<string, Record<string, { revenue: number; downloads: number }>> = {};
  for (const app of [...topApps, ...watchCandidates]) {
    const inputApp = apps.find(a => a.appId === app.appId);
    if (!inputApp) continue;
    periodData[app.appId] = {};
    for (const p of periods) {
      periodData[app.appId][p] = {
        revenue: inputApp.revenueByPeriod[p] || 0,
        downloads: inputApp.downloadsByPeriod[p] || 0,
      };
    }
  }

  // Generate Gemini insights
  let insight;
  try {
    insight = await generateGenreInsights(genre.name, topApps, watchCandidates, periodData);
  } catch (err) {
    console.error(`Gemini insight generation failed for ${genre.name}:`, err);
    // Fallback: use scores without LLM explanations
    insight = {
      summary: `Top rising games in ${genre.name} based on revenue acceleration, download momentum, anomaly detection, and cross-metric convergence.`,
      games: topApps.map((app, i) => ({
        ...app,
        rank: i + 1,
        explanation: 'AI analysis unavailable.',
      })),
      watchList: watchCandidates.slice(0, 2).map(app => ({
        ...app,
        reason: 'Score approaching top 5 threshold.',
      })),
    };
  }

  // Determine the latest period for the doc ID
  const latestPeriod = periods[periods.length - 1];
  const docId = `${genre.id}_${latestPeriod}`;

  // Store the insight doc
  await db.collection('insights').doc(docId).set({
    genreId: genre.id,
    period: latestPeriod,
    granularity,
    generatedAt: Timestamp.now(),
    summary: insight.summary,
    games: insight.games,
    watchList: insight.watchList,
  });

  // Store individual scores for all apps (for the Dashboard AI Score column)
  const batch = db.batch();
  const scoresRef = db.collection('insights').doc(docId).collection('scores');
  for (const scored of allScored) {
    batch.set(scoresRef.doc(scored.appId), {
      appId: scored.appId,
      score: scored.score,
      subScores: scored.subScores,
      computedAt: Timestamp.now(),
    });
  }
  await batch.commit();

  return { scored: allScored.length, topApps };
}

/**
 * Run the insights pipeline for all active genres.
 */
export async function runAllGenreInsights(
  granularity: 'month' | 'week' = 'month'
): Promise<{ genresProcessed: string[]; errors: string[] }> {
  const genresSnap = await db.collection('genres').where('active', '==', true).get();
  const genres = genresSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().name as string,
  }));

  const results: string[] = [];
  const errors: string[] = [];

  for (const genre of genres) {
    try {
      const { scored } = await runInsightsPipeline(genre, granularity);
      results.push(genre.name);
      console.log(`Insights generated for ${genre.name}: ${scored} apps scored`);
    } catch (err) {
      const msg = `Failed to generate insights for ${genre.name}: ${err}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  return { genresProcessed: results, errors };
}
```

**Step 2: Add routes to Cloud Function**

In `functions/src/index.ts`, add the import at the top:
```ts
import { runAllGenreInsights, runInsightsPipeline } from './insights/pipeline';
```

Add two new cases in the switch block (before `default`):
```ts
    case 'insights/generate': {
      // Generate insights for all active genres
      const granularity = (req.body?.granularity || 'month') as 'month' | 'week';
      const result = await runAllGenreInsights(granularity);
      return sendSuccess(res, result);
    }

    case 'insights/generate-genre': {
      // Generate insights for a single genre
      const { genreId, genreName, granularity: gran } = req.body || {};
      if (!genreId || !genreName) {
        return sendError(res, 400, 'genreId and genreName are required');
      }
      const result = await runInsightsPipeline(
        { id: genreId, name: genreName },
        (gran || 'month') as 'month' | 'week'
      );
      return sendSuccess(res, {
        scored: result.scored,
        topApps: result.topApps.map(a => ({ appId: a.appId, appName: a.appName, score: a.score })),
      });
    }
```

**Step 3: Verify build compiles**

Run: `cd functions && npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add functions/src/insights/pipeline.ts functions/src/index.ts
git commit -m "feat: add insights pipeline and API routes for Rising Star analysis"
```

---

### Task 9: Auto-Trigger After Fetch

**Files:**
- Modify: `functions/src/index.ts` (the existing `fetch/month` and `fetch/week` cases)

**Step 1: Add insight generation after fetch completion**

In `functions/src/index.ts`, find the existing `case 'fetch/trigger':` block. After the fetch completes successfully, add a call to generate insights. The pattern depends on how the existing fetch reports completion — look for where it calls `sendSuccess`.

Add after the fetch success response in the `fetch/month` case:
```ts
// Fire-and-forget: generate insights after fetch
runInsightsPipeline(
  { id: genreId, name: genreName },
  'month'
).catch(err => console.error('Post-fetch insight generation failed:', err));
```

Do the same for `fetch/week` with `'week'` granularity.

**Important:** This is fire-and-forget — don't await it or it will delay the fetch response. The insights will be ready shortly after the fetch completes.

**Step 2: Verify build compiles**

Run: `cd functions && npm run build`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: auto-trigger insight generation after data fetches"
```

---

### Task 10: Frontend — Add Recharts & Types

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`

**Step 1: Install Recharts**

Run: `cd frontend && npm install recharts`

**Step 2: Add insight types**

In `frontend/src/types/index.ts`, add:
```ts
export interface SubScores {
  revenueAcceleration: number;
  downloadMomentum: number;
  anomalyScore: number;
  crossMetricConvergence: number;
}

export interface InsightGame {
  appId: string;
  appName: string;
  publisherName: string;
  rank: number;
  score: number;
  subScores: SubScores;
  explanation: string;
}

export interface InsightWatchItem {
  appId: string;
  appName: string;
  publisherName: string;
  score: number;
  reason: string;
}

export interface GenreInsightDoc {
  genreId: string;
  period: string;
  granularity: 'month' | 'week';
  generatedAt: Date;
  summary: string;
  games: InsightGame[];
  watchList: InsightWatchItem[];
}
```

**Step 3: Add API call for generating insights**

In `frontend/src/lib/api.ts`, add:
```ts
export async function generateInsights(granularity: 'month' | 'week' = 'month') {
  return apiCall('insights/generate', { granularity });
}
```

**Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/types/index.ts frontend/src/lib/api.ts
git commit -m "feat: add Recharts, insight types, and insights API call"
```

---

### Task 11: Frontend — useInsights Hook

**Files:**
- Create: `frontend/src/hooks/useInsights.ts`

**Step 1: Create the hook**

This hook loads insight documents from Firestore for selected genres. Pattern follows `useMultiGenreSnapshots.ts`.

Create `frontend/src/hooks/useInsights.ts`:
```ts
import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Genre, GenreInsightDoc } from '../types';

export function useInsights(
  selectedGenres: Genre[],
  granularity: 'month' | 'week' = 'month'
) {
  const [insights, setInsights] = useState<GenreInsightDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setInsights([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const results: GenreInsightDoc[] = [];

        for (const genre of selectedGenres) {
          // Get the most recent insight doc for this genre
          const q = query(
            collection(db, 'insights'),
            where('genreId', '==', genre.id),
            where('granularity', '==', granularity),
            orderBy('generatedAt', 'desc'),
            limit(1)
          );

          const snap = await getDocs(q);
          if (!snap.empty) {
            const doc = snap.docs[0];
            const data = doc.data();
            results.push({
              genreId: data.genreId,
              period: data.period,
              granularity: data.granularity,
              generatedAt: data.generatedAt?.toDate() || new Date(),
              summary: data.summary,
              games: data.games || [],
              watchList: data.watchList || [],
            });
          }
        }

        if (!cancelled) {
          setInsights(results);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load insights');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedGenres, granularity, refreshCounter]);

  const refresh = useCallback(() => setRefreshCounter(c => c + 1), []);

  return { insights, loading, error, refresh };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/useInsights.ts
git commit -m "feat: add useInsights hook to load Rising Star data from Firestore"
```

---

### Task 12: Frontend — useAppScores Hook (for Dashboard column)

**Files:**
- Create: `frontend/src/hooks/useAppScores.ts`

**Step 1: Create the hook**

This hook loads the individual app scores from the `insights/{docId}/scores` subcollection so the Dashboard table can show the AI Score column.

Create `frontend/src/hooks/useAppScores.ts`:
```ts
import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Genre, SubScores } from '../types';

export interface AppScore {
  appId: string;
  score: number;
  subScores: SubScores;
}

export function useAppScores(
  selectedGenres: Genre[],
  granularity: 'month' | 'week' = 'month'
) {
  const [scoreMap, setScoreMap] = useState<Map<string, AppScore>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setScoreMap(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const map = new Map<string, AppScore>();

      for (const genre of selectedGenres) {
        // Find the latest insight doc for this genre
        const q = query(
          collection(db, 'insights'),
          where('genreId', '==', genre.id),
          where('granularity', '==', granularity),
          orderBy('generatedAt', 'desc'),
          limit(1)
        );

        const insightSnap = await getDocs(q);
        if (insightSnap.empty) continue;

        const insightDoc = insightSnap.docs[0];
        const scoresSnap = await getDocs(collection(insightDoc.ref, 'scores'));

        for (const scoreDoc of scoresSnap.docs) {
          const data = scoreDoc.data();
          const existing = map.get(data.appId);
          // If app appears in multiple genres, take the higher score
          if (!existing || data.score > existing.score) {
            map.set(data.appId, {
              appId: data.appId,
              score: data.score,
              subScores: data.subScores,
            });
          }
        }
      }

      if (!cancelled) {
        setScoreMap(map);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedGenres, granularity]);

  return { scoreMap, loading };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/useAppScores.ts
git commit -m "feat: add useAppScores hook for Dashboard AI Score column"
```

---

### Task 13: Frontend — Insights Page

**Files:**
- Create: `frontend/src/pages/Insights.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/components/Layout.tsx` (add nav item)

**Step 1: Create the Insights page**

Create `frontend/src/pages/Insights.tsx`. This is the largest frontend component. It includes:
- Genre pill selector (reuse pattern from Dashboard)
- Per-genre Rising Stars cards with ranked game list
- Gemini-generated summaries and explanations
- Sub-score mini bars
- Sparkline charts (Recharts)
- Watch list section
- "Re-analyze" button

```tsx
import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { db } from '../lib/firebase';
import { generateInsights } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import type { Genre, InsightGame, GenreInsightDoc } from '../types';

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 60 ? 'bg-green-100 text-green-800'
    : score >= 40 ? 'bg-yellow-100 text-yellow-800'
    : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${color}`}>
      {score}
    </span>
  );
}

function SubScoreBar({ label, value, max = 25 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-gray-500 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div
          className="bg-green-500 h-1.5 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-gray-400">{value}</span>
    </div>
  );
}

function GameCard({ game, isExpanded, onToggle }: {
  game: InsightGame;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Placeholder sparkline data — in production, this would come from period data
  // For now we derive a simple trend from the score
  const sparkData = [
    { v: game.score * 0.3 },
    { v: game.score * 0.5 },
    { v: game.score * 0.7 },
    { v: game.score * 0.85 },
    { v: game.score },
  ];

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-700 font-bold text-sm">
            {game.rank}
          </div>
          <div>
            <div className="font-medium text-gray-900">{game.appName}</div>
            <div className="text-sm text-gray-500">{game.publisherName}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-20 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke="#22c55e" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ScoreBadge score={game.score} />
        </div>
      </div>

      <button
        onClick={onToggle}
        className="mt-2 text-xs text-blue-600 hover:text-blue-800"
      >
        {isExpanded ? 'Hide details' : 'Show details'}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gray-700">{game.explanation}</p>
          <div className="space-y-1">
            <SubScoreBar label="Rev. Accel." value={game.subScores.revenueAcceleration} />
            <SubScoreBar label="DL Momentum" value={game.subScores.downloadMomentum} />
            <SubScoreBar label="Anomaly" value={game.subScores.anomalyScore} />
            <SubScoreBar label="Convergence" value={game.subScores.crossMetricConvergence} />
          </div>
        </div>
      )}
    </div>
  );
}

function GenreInsightCard({ insight, genreName }: { insight: GenreInsightDoc; genreName: string }) {
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  const timeAgo = (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{genreName}</h2>
        <span className="text-xs text-gray-400">
          Last analyzed: {timeAgo(insight.generatedAt)}
        </span>
      </div>

      {insight.summary && (
        <p className="text-sm text-gray-600 mb-4 bg-blue-50 p-3 rounded-lg">
          {insight.summary}
        </p>
      )}

      <h3 className="text-sm font-medium text-gray-700 mb-3">Top 5 Rising Stars</h3>
      <div className="space-y-3">
        {insight.games.map(game => (
          <GameCard
            key={game.appId}
            game={game}
            isExpanded={expandedGame === game.appId}
            onToggle={() => setExpandedGame(
              expandedGame === game.appId ? null : game.appId
            )}
          />
        ))}
      </div>

      {insight.watchList.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-700 mt-6 mb-3">Watch List</h3>
          <div className="space-y-2">
            {insight.watchList.map(item => (
              <div key={item.appId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-900">{item.appName}</span>
                  <span className="text-xs text-gray-500 ml-2">{item.publisherName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{item.reason}</span>
                  <ScoreBadge score={item.score} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Insights() {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<Genre[]>([]);
  const [generating, setGenerating] = useState(false);
  const [granularity, setGranularity] = useState<'month' | 'week'>('month');

  const { insights, loading, error, refresh } = useInsights(selectedGenres, granularity);

  // Load genres on mount
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'genres'));
      const loaded = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Genre));
      setGenres(loaded.filter(g => g.active));
      setSelectedGenres(loaded.filter(g => g.active));
    })();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateInsights(granularity);
      refresh();
    } catch (err) {
      console.error('Failed to generate insights:', err);
    } finally {
      setGenerating(false);
    }
  };

  const toggleGenre = (genre: Genre) => {
    setSelectedGenres(prev =>
      prev.some(g => g.id === genre.id)
        ? prev.filter(g => g.id !== genre.id)
        : [...prev, genre]
    );
  };

  const genreMap = new Map(genres.map(g => [g.id, g]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Rising Stars</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${granularity === 'month' ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
              onClick={() => setGranularity('month')}
            >Monthly</button>
            <button
              className={`px-3 py-1.5 text-sm ${granularity === 'week' ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
              onClick={() => setGranularity('week')}
            >Weekly</button>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {generating ? 'Analyzing...' : 'Re-analyze'}
          </button>
        </div>
      </div>

      {/* Genre pills */}
      <div className="flex flex-wrap gap-2">
        {genres.map(genre => (
          <button
            key={genre.id}
            onClick={() => toggleGenre(genre)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedGenres.some(g => g.id === genre.id)
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {genre.name}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading insights...</div>
      ) : insights.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 mb-4">No insights generated yet.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {generating ? 'Analyzing...' : 'Generate Insights'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {insights.map(insight => (
            <GenreInsightCard
              key={insight.genreId}
              insight={insight}
              genreName={genreMap.get(insight.genreId)?.name || insight.genreId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

In `frontend/src/App.tsx`, add the import:
```ts
import Insights from './pages/Insights';
```

Add the route inside `<Routes>`:
```tsx
<Route path="/insights" element={<Insights />} />
```

**Step 3: Add nav item to Layout.tsx**

In `frontend/src/components/Layout.tsx`, add to the `navItems` array:
```ts
{
  path: '/insights',
  label: 'Rising Stars',
  match: (p: string) => p === '/insights',
  icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
    </svg>
  ),
},
```

**Step 4: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add frontend/src/pages/Insights.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat: add Insights page with Rising Stars cards, sparklines, and genre insights"
```

---

### Task 14: Frontend — Dashboard AI Score Column

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Import and use the useAppScores hook**

In `frontend/src/pages/Dashboard.tsx`, add:
```ts
import { useAppScores } from '../hooks/useAppScores';
```

Call the hook alongside existing hooks:
```ts
const { scoreMap } = useAppScores(selectedGenres, granularity);
```

**Step 2: Add AI Score column to the table definition**

Find the column definitions array. Add a new column after the "Rising" column and before the time-period columns:
```ts
{
  id: 'aiScore',
  header: 'AI Score',
  accessorFn: (row: ComparisonRow) => scoreMap.get(row.appId)?.score ?? null,
  cell: ({ getValue }: { getValue: () => number | null }) => {
    const score = getValue();
    if (score === null) return <span className="text-gray-300">—</span>;
    const color = score >= 60 ? 'text-green-700 bg-green-50'
      : score >= 40 ? 'text-yellow-700 bg-yellow-50'
      : 'text-gray-500 bg-gray-50';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
        {score}
      </span>
    );
  },
  sortingFn: 'basic',
},
```

**Step 3: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: add AI Score column to Dashboard table"
```

---

### Task 15: Firestore Rules & Indexes

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

**Step 1: Add Firestore rules for insights collection**

In `firestore.rules`, add rules for the new `insights` collection inside the existing rules block. Follow the same auth pattern (authenticated `@unity3d.com` users can read, write is restricted):
```
match /insights/{docId} {
  allow read: if request.auth != null;
  allow write: if false; // only written by Cloud Functions

  match /scores/{scoreId} {
    allow read: if request.auth != null;
    allow write: if false;
  }
}
```

**Step 2: Add Firestore indexes**

In `firestore.indexes.json`, add composite indexes for the insights queries:
```json
{
  "collectionGroup": "insights",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "genreId", "order": "ASCENDING" },
    { "fieldPath": "granularity", "order": "ASCENDING" },
    { "fieldPath": "generatedAt", "order": "DESCENDING" }
  ]
}
```

**Step 3: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "feat: add Firestore rules and indexes for insights collection"
```

---

### Task 16: End-to-End Verification

**Step 1: Build both projects**

Run: `cd functions && npm run build && cd ../frontend && npm run build`
Expected: Both compile without errors

**Step 2: Run backend tests**

Run: `cd functions && npm test`
Expected: All scoring engine tests pass

**Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: finalize AI Rising Stars feature implementation"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Infrastructure | Set up Vitest for Cloud Functions |
| 2 | Backend | Revenue Acceleration sub-score (TDD) |
| 3 | Backend | Download Momentum sub-score (TDD) |
| 4 | Backend | Anomaly Score sub-score (TDD) |
| 5 | Backend | Cross-Metric Convergence sub-score (TDD) |
| 6 | Backend | Composite score & top-N selection (TDD) |
| 7 | Backend | Gemini client for insight generation |
| 8 | Backend | Insights pipeline + API routes |
| 9 | Backend | Auto-trigger after data fetches |
| 10 | Frontend | Install Recharts, add types & API calls |
| 11 | Frontend | useInsights hook |
| 12 | Frontend | useAppScores hook |
| 13 | Frontend | Insights page (cards, sparklines, summaries) |
| 14 | Frontend | Dashboard AI Score column |
| 15 | Infrastructure | Firestore rules & indexes |
| 16 | Verification | End-to-end build & test verification |
