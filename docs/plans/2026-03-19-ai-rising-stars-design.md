# AI Rising Stars Detection — Design Document

**Date:** 2026-03-19
**Status:** Approved

## Problem

Users manually scan a large table of 500+ games per genre to spot upcoming hits. This is time-consuming and easy to miss subtle trends. We need an automated system that surfaces the most promising rising star games.

## Approach: Hybrid (Statistical Scoring + LLM Insights)

A statistical scoring engine computes a deterministic Rising Star Score per game, then the top scorers are sent to Gemini (via Firebase) for natural-language insight generation.

## Scoring Engine

Runs as a Cloud Function. Computes a **Rising Star Score (0-100)** per game per genre using 4 equally-weighted signals (0-25 each):

### 1. Revenue Acceleration (0-25)
Weighted moving average of MoM/WoW revenue % changes, with recent periods weighted more heavily. Accelerating growth (e.g., +5% → +15% → +30%) scores higher than steady growth (+20% → +20% → +20%).

### 2. Download Momentum (0-25)
Same weighted moving average approach for download % changes. Early install traction often precedes revenue spikes.

### 3. Anomaly Score (0-25)
Z-score of the latest period's revenue/downloads vs. the game's own historical mean and standard deviation. Catches sudden breakouts — a game flat for 6 months that suddenly jumps 3x gets a high anomaly score.

### 4. Cross-Metric Convergence (0-25)
Bonus when both revenue AND downloads trend up simultaneously. Revenue up + downloads up = strong organic growth signal. Revenue up + downloads flat = weaker signal (possibly pricing changes, not real growth).

### Thresholds
- Games scoring **60+** are flagged as "Rising Stars"
- **Top 5** per genre are highlighted
- Sub-scores are stored alongside the composite score for transparency

## LLM Insights Layer (Gemini via Firebase)

After scoring, the top 5 games per genre are sent to **Gemini API** (Firebase Vertex AI) for natural-language interpretation.

### Input to Gemini
For each top 5 game:
- Game name, publisher, genre
- Rising Star Score + 4 sub-scores
- Last 3-6 periods of revenue and download data with % changes
- Rising status history

### Gemini Generates
1. **Genre Summary** — 2-3 sentences on overall genre trends
2. **Per-game insight** — 2-3 sentences per game explaining WHY it's rising (e.g., "3 consecutive months of accelerating revenue while downloads grew steadily suggests monetization improvements rather than UA-driven growth")
3. **Watch List** — 1-2 games just outside the top 5 worth monitoring

### Cost Control
Only top 5 per genre are sent (not hundreds of games). With ~14 genres, that's ~14 API calls per analysis run — small payloads, low cost.

## Data Storage

### New Firestore Collection: `insights/{genreId}_{period}`

```typescript
interface InsightDoc {
  genreId: string;
  period: string;              // e.g., "2026-03" or "2026-W12"
  granularity: "month" | "week";
  generatedAt: Timestamp;

  summary: string;             // Gemini genre summary

  games: Array<{
    appId: string;
    appName: string;
    publisherName: string;
    rank: number;              // 1-5
    score: number;             // 0-100 composite
    subScores: {
      revenueAcceleration: number;    // 0-25
      downloadMomentum: number;       // 0-25
      anomalyScore: number;           // 0-25
      crossMetricConvergence: number; // 0-25
    };
    explanation: string;       // Gemini per-game insight
  }>;

  watchList: Array<{
    appId: string;
    appName: string;
    publisherName: string;
    score: number;
    reason: string;            // Gemini explanation
  }>;
}
```

### New Subcollection: `insights/{genreId}_{period}/scores/{appId}`

Stores the Rising Star Score for ALL scored games (not just top 5), enabling the Dashboard table to show the AI Score column for every game.

```typescript
interface AppScore {
  appId: string;
  score: number;
  subScores: {
    revenueAcceleration: number;
    downloadMomentum: number;
    anomalyScore: number;
    crossMetricConvergence: number;
  };
  computedAt: Timestamp;
}
```

## Trigger & Pipeline

### Automatic (after data fetch)
When a weekly or monthly fetch completes, the scoring engine runs for that genre. After all genres finish, Gemini insight generation runs.

### Manual (on-demand)
"Generate Insights" button on the Insights page triggers analysis for all active genres.

### Pipeline Flow
```
Data Fetch completes
  → Scoring Engine (per genre, compute scores for all apps)
  → Store scores in Firestore
  → LLM Insight Generation (top 5 per genre → Gemini)
  → Store insights in Firestore
  → Frontend picks up new data via Firestore listeners
```

### Staleness
Each insight doc has `generatedAt`. UI shows "Last analyzed: X ago" so users know freshness.

## Frontend: Insights Page (`/insights`)

New page accessible from sidebar navigation.

### Layout

**Genre Selector** — Same genre pill toggles as Dashboard.

**Per Genre — Rising Stars Card:**
- Genre name + "Last analyzed: X ago"
- AI-generated genre summary
- Top 5 Rising Stars as ranked list:
  - Rank badge (1-5)
  - App name + publisher
  - Rising Star Score (0-100) as colored badge
  - 4 sub-score mini bars
  - Gemini explanation (collapsible)
  - Sparkline chart (last 3-6 periods revenue trend)
- Watch List section (1-2 games)

**Actions:**
- "Re-analyze" button for on-demand analysis
- Click game to navigate to Dashboard filtered to that game

## Frontend: Dashboard Table Integration

**New "AI Score" column:**
- Shows Rising Star Score (0-100)
- Color gradient: gray → yellow → green as score increases
- Sortable column

**Visual indicator:**
- Top 5 Rising Star games get a subtle glow/sparkle on their row

No other changes to existing table functionality.

## Tech Stack

- **Scoring Engine:** Firebase Cloud Function (TypeScript)
- **LLM:** Gemini API via Firebase Vertex AI SDK
- **Storage:** Firestore (same `companalysis` database)
- **Frontend:** React + TypeScript (same Vite app)
