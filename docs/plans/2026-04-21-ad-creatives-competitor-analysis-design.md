# Ad Creatives Competitor Analysis — Design Document

**Date:** 2026-04-21
**Status:** Approved

## Problem

The team already runs competitor analysis for app rankings (revenue + downloads) via Sensor Tower. They now want the same depth of insight for **ad creatives**: what competitors are running, what is working, what new concepts are emerging, and who dominates share of voice per genre.

Manually browsing Sensor Tower's Ad Intelligence UI is slow, does not track week-over-week change, and gives no opinionated signal. We want a first-class companion experience to the existing app-level analysis.

## Requirements (captured during brainstorming)

- **Primary job:** combined dashboard covering winning creatives, new concept detection, volume/network trends, and share of voice.
- **App scope:** hybrid — top N per genre (auto-derived from existing snapshots) plus a user-curated watchlist.
- **Networks:** top 7 — Meta (FB/IG), TikTok, AppLovin, Unity Ads, YouTube, Google Ads, IronSource.
- **AI layer:** full parity with Rising Stars — statistical Winning Creative Score (0-100) plus Gemini-generated natural-language explanations.
- **Cadence:** weekly; piggyback on the existing Sunday scheduled job.
- **UI:** new dedicated `/creatives` page.
- **Prerequisite (Task 0):** verify the team's Sensor Tower subscription includes Ad Intelligence before any implementation work begins.

## Approach

**Approach A — Full parity with the Rising Stars pipeline (selected).** Mirror the existing `sensorTower/` and `insights/` modules with new `adIntel/` and `creativeInsights/` modules. Same Firebase project, same auth, same deploy flow, new Firestore collections. This keeps the two pipelines cleanly decoupled and lets each evolve (or fail) independently while leveraging every pattern the team already knows.

Alternatives considered: nesting creatives under existing app docs (rejected — muddles two pipelines with different cadences) and a thin client-side pass-through MVP (rejected — conflicts with the "full AI parity" requirement and creates rate-limit risk).

## Data Ingestion

### New module: `functions/src/adIntel/`

`client.ts` wraps Sensor Tower Ad Intelligence endpoints, reusing the existing `SENSOR_TOWER_AUTH_TOKEN` secret, retry/backoff plumbing, and 300 ms inter-request delay. Exposes:

- `fetchCreativesForApp(appId, network, country, dateRange)` — returns creative objects with `creativeId`, `network`, `format` (video/image/playable), `firstSeen`, `lastSeen`, `durationDays`, `previewUrl`, `videoUrl`, `thumbnailUrl`, `aspectRatio`, `countries`, `shareOfVoice` (if available on plan), `impressions` (if available).
- `fetchNetworkShareOfVoice(appId, country, dateRange)` — per-network impression share.

### Orchestrator: `fetchCreativesForGenre.ts` (mirrors `fetchAndStoreWeek`)

1. Resolve apps in scope for the genre = top N from the latest `snapshots/{genreId}_{latestMonth}` (N = 25 default, per-genre configurable) ∪ watchlist app IDs.
2. For each app × each of the 7 networks × genre country, fetch creatives over a rolling 30-day window.
3. Deduplicate by `creativeId` across networks (a creative can run on multiple networks).
4. Resolve app metadata via the existing `appNames` cache — no new cache needed.
5. Write to Firestore:

```
creativeSnapshots/{genreId}_week_{week}
  └─ creatives/{creativeId}   ← full creative docs
creativeLatest/{creativeId}   ← most recent snapshot of each creative (gallery fast path)
```

**Cost guardrail (rough):** 7 networks × 25 apps × 14 genres ≈ 2,450 Ad Intel calls per weekly run. To be confirmed against the account's rate card in Task 0.

## Winning Creative Score (Statistical)

### New module: `functions/src/creativeInsights/`

Deterministic **Winning Creative Score (0-100)** per creative per weekly snapshot. Four equally-weighted sub-scores (0-25 each), mirroring Rising Stars:

1. **Longevity (0-25)** — Days running continuously (`lastSeen - firstSeen`). Logarithmic curve: 7 days ≈ 8 pts, 30 days ≈ 18 pts, 60+ days = 25 pts. Advertisers kill losers fast; long-running ads are almost always winners.
2. **Network Breadth (0-25)** — Distinct tracked networks the same creative runs on. Linear: 1 network = 4 pts, 7 networks = 25 pts.
3. **Impression Momentum (0-25)** — Weighted moving average of week-over-week share-of-voice change (same accelerating-growth curve used for revenue in Rising Stars). If SoV is unavailable on the plan, fall back to distinct-country-count growth.
4. **Freshness-Adjusted Persistence (0-25)** — Bonus for creatives that are both new-ish (first seen in last 21 days) AND have already cleared a longevity threshold (≥14 days). Surfaces the "just proven" winners worth imitating now, not ancient evergreens.

**Thresholds**
- Score ≥ 60 → flagged as "Winning Creative"
- Top 10 per genre per week highlighted
- All sub-scores stored alongside the composite for transparency

### Storage

```
creativeInsights/{genreId}_week_{week}
  └─ scores/{creativeId}   ← score + sub-scores for ALL creatives
```

Two-tier rollup + per-item subcollection pattern matches `insights/`, so the gallery can render an AI Score on every creative without paginating through the winners list.

## LLM Insights Layer (Gemini via Firebase Vertex AI)

### Trigger

After scoring finishes for a genre, the top 10 creatives (score ≥ 60) are sent to Gemini — one call per genre per week. ~14 calls/week total, tiny cost.

### Input per creative

- App name, publisher, genre
- Networks the creative runs on
- Format, aspect ratio, duration (for video)
- `firstSeen`, `lastSeen`, `durationDays`
- Winning Score + 4 sub-scores
- `previewUrl` / `thumbnailUrl` passed as multimodal input when Firebase Vertex plan permits; metadata-only fallback otherwise
- App description (reused from the existing iTunes-backed correlations pipeline)

### Gemini generates

1. **Genre creative summary** — 2-3 sentences on dominant creative themes this week.
2. **Per-creative insight** — 2-3 sentences per top-10 creative explaining why it is likely winning.
3. **Emerging concepts** — 1-3 creative *concepts* newly common this week across multiple competitors (the "new concepts detector").
4. **Watch list** — 2-3 creatives just outside the top 10 worth monitoring, with a one-line reason.

### Storage (extends the scoring doc)

```typescript
interface CreativeInsightDoc {
  genreId: string;
  week: string;
  generatedAt: Timestamp;

  summary: string;

  winners: Array<{
    creativeId: string;
    appId: string;
    appName: string;
    rank: number;
    score: number;
    subScores: {
      longevity: number;
      networkBreadth: number;
      impressionMomentum: number;
      freshnessAdjustedPersistence: number;
    };
    explanation: string;
  }>;

  emergingConcepts: Array<{
    title: string;
    description: string;
    exampleCreativeIds: string[];
  }>;

  watchList: Array<{
    creativeId: string;
    appId: string;
    appName: string;
    score: number;
    reason: string;
  }>;
}
```

**Cost control:** only top 10 + ~20 for concept clustering + ~5 for watch list sent per genre per week.

## Frontend — `/creatives` Page

New top-level page, sidebar nav parity with `/insights`.

### Region 1 — Genre selector + freshness

Same genre pill toggles as Dashboard and Insights. "Last analyzed: X ago" + "Re-analyze" button for a manual run.

### Region 2 — AI Highlights strip

Three side-by-side cards:

- **Genre Creative Summary** — Gemini summary (collapsible).
- **Emerging Concepts** — up to 3 concept cards with title, one-sentence description, 2-4 clickable example thumbnails (click → scroll to creative in gallery).
- **Watch List** — 2-3 compact tiles (thumbnail, app name, score, reason).

### Region 3 — Creative Gallery

Responsive grid (4/2/1 columns). Each tile:

- Thumbnail with play-on-hover for videos
- Winning Score badge, color-graded gray → yellow → green (matches Rising Stars palette)
- Subtle glow/sparkle for top-10 winners
- Network chips (colored pills)
- Format chip (Video / Image / Playable)
- App name + publisher (link to Dashboard filtered to that app)
- `durationDays` + `firstSeen` caption
- Click → modal with full-size player, sub-score bars, Gemini explanation, "Open in Sensor Tower" link

### Filters (sticky top-bar inside Region 3)

- Network multi-select
- Format multi-select
- App multi-select (autocomplete incl. watchlist)
- "New this week" toggle (firstSeen ≤ 7 days)
- "Winners only" toggle (score ≥ 60)
- Sort: Winning Score (default) · Duration running · First seen · Share of voice
- Search box (app name, publisher, Gemini explanation)

### States

- First-time genre: "No creatives captured yet — the next weekly fetch runs Sunday. Run now?" with a button.
- Gemini failure: gallery still renders; banner says "AI insights unavailable for this run, showing statistical scores only."

### Watchlist entry point

Settings page gains a "Competitor Watchlist" section — autocomplete app picker writes to a shared `watchlist/{teamDocId}` doc. Apps added here are pulled every weekly run regardless of Dashboard ranking.

### Hooks and APIs

Hooks mirror `useGenreDataStatus`:

- `useCreativeInsights(genreId, week)`
- `useCreativesForGenre(genreId, filters)`
- `useCreativeWatchlist()`

New API routes in `functions/src/api/creatives.ts`:

- `POST /creatives/trigger/:genreId` — manual re-analyze
- `POST /creatives/watchlist` / `DELETE /creatives/watchlist/:appId`

Reads go directly to Firestore from the client, matching the existing pattern.

## Pipeline, Scheduling & Failure Handling

### Sunday weekly job (extended)

```
Per genre:
  1. syncScheduledGenreSnapshots(genre)            ← existing
  2. runRisingStarsForGenre(genre)                 ← existing
  3. fetchCreativesForGenre(genre, week)           ← NEW
  4. scoreCreativesForGenre(genre, week)           ← NEW
  5. generateCreativeInsights(genre, week)         ← NEW
```

Order matters: step 3 reads the fresh "top N apps" from step 1's snapshot, avoiding races.

### Per-genre isolation

Each genre runs independently and fully within one invocation. One genre's crash never blocks others.

### Timeout strategy

Expected per-genre runtime ≈ 2-3 minutes (≈ 175 Ad Intel calls at 300 ms + scoring + Gemini). Risks the 9-minute cap if all genres share one invocation, so we **fan out per genre**: a top-level scheduler invokes an HTTP-callable `runCreativePipelineForGenre(genreId, week)` per genre sequentially, each with its own 9-minute budget. Cloud Tasks escape hatch parked for later only if timeouts actually occur.

### Manual trigger

`POST /creatives/trigger/:genreId` runs steps 3-5 on demand (used by the "Re-analyze" button and for genres added mid-week).

### Failure handling

Each phase returns `{success, error}` independently, matching `syncScheduledGenreSnapshots`. If step 3 partially fails (e.g. one network returns 403), we store what we got and write `partialErrors: string[]` on the snapshot so the UI can show a degraded-mode banner. Steps 4 and 5 proceed with whatever data is present. No all-or-nothing.

### Idempotency

`creativeId` is the doc ID everywhere, so re-running a week merges/updates rather than duplicates. Rollup docs use `{genreId}_week_{week}` keys — re-runs overwrite cleanly.

### Staleness / reaper

`creativeLatest` keeps the most recent snapshot of each creative. A reaper step at the end of the weekly job removes entries whose `lastSeen` is older than 60 days.

### Observability

Reuse existing `console.log` conventions and the Settings status view. Add a "Creatives: last fetched / last analyzed / last errored" row to `useGenreDataStatus`.

### Cost envelope (rough)

- ~2,450 Sensor Tower Ad Intel calls/week
- ~14 Gemini calls/week
- ~30k Firestore writes/week
- Well inside current free-tier ceilings; to be confirmed in Task 0.

## Security, Rules & Indexes

### Firestore rules

Extend rules with the same auth model as `snapshots/` and `insights/`:

- `creativeSnapshots/**`, `creativeLatest/**`, `creativeInsights/**` — read: signed-in team; write: server-only.
- `watchlist/{docId}` — read+write: signed-in team (single shared team doc).

### Firestore indexes

Composite indexes for the gallery:

- `creativeLatest`: `(genreId, score desc)`, `(genreId, firstSeen desc)`, `(genreId, durationDays desc)`
- `creativeInsights/scores`: `(score desc)`

Deploy via the existing `deploy-prod.sh` flow.

### Secrets

Reuse `SENSOR_TOWER_AUTH_TOKEN`. If Task 0 reveals Ad Intel requires a separate credential, add `SENSOR_TOWER_AD_INTEL_TOKEN` as a second `defineSecret` and wire only the new module to it. Gemini reuses existing Vertex AI config.

## Testing

Mirrors the existing Vitest setup under `functions/src/__tests__/`:

- **Unit tests** for each sub-score function and the composite scorer.
- **Integration test**: one end-to-end run of `fetchCreativesForGenre → scoreCreativesForGenre → mocked-Gemini` using committed fixture data. Verifies Firestore doc shapes match the types.
- No frontend tests for MVP — the app has none; not expanding scope here.

## Rollout Plan

1. **Task 0 — Verify Ad Intel access.** Throwaway script or tiny Cloud Function calling one Ad Intel endpoint with the existing token. Blocks all other work until a `200` is confirmed (or a separate token is acquired).
2. **Phase 1 — Ingestion.** Ship data fetch + storage, gated by an `enableCreatives` boolean on `genres/{id}` (default false). Turn on for one pilot genre; verify Firestore shape.
3. **Phase 2 — Scoring + page (read-only, no AI).** Team can browse the gallery and see statistical scores.
4. **Phase 3 — Gemini layer.** AI Highlights strip goes live.
5. **Phase 4 — Scheduled job + watchlist UI.** Wire the Sunday extension and the Settings watchlist; enable the feature flag across all genres.

Each phase is independently shippable and revertible. Rough estimate: 2-3 weeks for one engineer, less in parallel.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Ad Intel not on the Sensor Tower plan | Task 0 gates all downstream work. |
| SoV / impression fields unavailable on tier | Sub-score 3 falls back to distinct-country-count growth. |
| Per-genre Cloud Function timeout | Per-genre fan-out; Cloud Tasks escape hatch ready. |
| Rate limits (429) on larger genres | Existing `fetchWithRetry` backoff; tune delay or split per-network if persistent. |
| Gemini multimodal costs or refusals | Metadata-only fallback path, toggleable by config. |
| Storage growth from media | Store Sensor Tower URLs only; never re-host media. Zero new egress. |
| Creative team distrusts AI scores | Sub-scores always visible; Gemini explanations always expandable; filters and watchlist let the team escape AI ranking entirely. |

## Out of Scope (YAGNI)

- Uploading our own creatives for A/B comparison.
- Creative performance attribution back to our install data.
- Automated thumbnail/video re-hosting.
- Daily cadence, multi-geo per creative, per-app drill-down page.
- Share-to-Slack for individual creatives.

## Tech Stack

- **Ad data ingestion:** Firebase Cloud Function (TypeScript), new `functions/src/adIntel/` module.
- **Scoring:** Cloud Function, new `functions/src/creativeInsights/` module.
- **LLM:** Gemini via Firebase Vertex AI SDK (same as Rising Stars).
- **Storage:** Firestore (same `companalysis` database).
- **Frontend:** React + TypeScript (same Vite app), new `/creatives` page and hooks.
