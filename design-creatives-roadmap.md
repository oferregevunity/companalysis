# Creatives — Feature Roadmap

**Date:** 2026-07-28
**Status:** In progress. **Shipped + deployed 2026-07-28:** #1, the video
foundation + slide-14 overhaul, #8, **#3** (concept generator), **#4** (variant
grouping) + SoV-default sort, **#5** (side-by-side compare), and the
video-analysis failure diagnostics + 14.5 MB cap, dismiss suggested competitors
(+ "Suggest more"), and **#6** (week-over-week trend). **Remaining:**
#2 (new-winner alerts — blocked on delivery channel), and the scoped GCS
`fileData` v2 for oversize videos. **Next:** #2 (pending delivery-channel
decision) or GCS `fileData` v2.
**Context:** Builds on the game-workspace flow ([design-game-competitor-analysis.md](design-game-competitor-analysis.md)).

## Progress

- [x] Roadmap doc
- [x] **#1 Market Pulse label fix** — deployed
- [x] **Video foundation + slide-14 overhaul** — inline-to-Vertex, top-10 videos
  by score; deployed; verified in prod
- [x] **#8 On-demand per-creative video analysis** — "Analyze this video" in the
  detail modal; deployed (`compAnalysisApi` + hosting)
- [x] **#3 AI Concept Generator** — slice 1 (pure core) + slice 2 (route +
  `ConceptGeneratorModal`, header entry point); grounded in analyzed competitor
  videos; concepts persisted on the insight doc. Deployed.
- [x] **Video-analysis failure diagnostics + on-demand cap** — reasons surfaced
  to the modal + `console.warn` (no more silent "could not be read"); on-demand
  cap 12 → 14.5 MB (inline ceiling). Deployed 2026-07-28.
- [ ] #2 Competitor new-winner alerts (blocked on delivery-channel decision)
- [x] **#4 Variant grouping** — client-side `groupVariants(phashionGroup)`; one
  representative tile with aggregated SoV/longevity + "×N / +N games" badge;
  default-on "Group variants" toggle. Deployed 2026-07-28 (with SoV-default sort).
- [x] **#5 Side-by-side compare** — "Compare" mode → pick 2 tiles → diff modal
  (stats / hook / themes / motivations / why-it-wins / video segments + predicted
  strengths), plus a "my best vs their best" preset. Deployed 2026-07-28.
- [x] **#6 Week-over-week trend** — dedicated Trends modal (header entry point).
  Client-side `buildCompositionTrend` (hook/motivation share across accumulated
  weekly insight docs + WoW deltas + top movers) via `useWorkspaceTrend`
  (reuses the `genreId + generatedAt` index, no new index), plus `buildFatigue`
  (weeks-live from `durationDays`, variant-collapsed, winners-first) off the
  current week — so the fatigue read works today and composition fills in as
  history accrues (degrades to a "N week(s) so far" note below 2 weeks). Built
  2026-07-30, awaiting deploy.
- [x] **Dismiss suggested competitors** — per-workspace `dismissedAppIds`
  blocklist; removing a competitor now sticks (AI re-discovery skips it),
  re-adding un-dismisses, "N hidden · Restore" in the rail. Deployed 2026-07-28.
- [ ] **Video foundation v2 — GCS `fileData` for oversize videos** (scoped below)

Eight workstreams prioritized with RICE. This doc is the source of truth for
scope + sequencing; each feature keeps its detail here until it ships.

## Two facts that shaped the plan

1. **Variant grouping is cheap.** Sensor Tower already returns `phashionGroup`
   (`functions/src/adIntel/types.ts`) as the cross-network dedup key, so #4 is a
   client-side `groupBy`, not a matching heuristic.
2. **The video-prompt overhaul and #8 are one engine.** Today
   `buildCreativePrompt` (`functions/src/creativeInsights/geminiClient.ts`) is
   **metadata-only** — Gemini never sees the creative; it infers the hook from
   app name, format, networks, score, and ad copy. Slide 14's rubric requires
   *watching the video*, so both features sit on a shared "multimodal ingestion"
   foundation.

**Data caveat baked into all video features:** we do NOT have real Hook Rate /
Hold Rate / IPM / CPI / ROAS — those are the producer's own UA metrics. Our
signal is a longevity + network-breadth + SoV proxy (`scoringEngine.ts`). Video
analysis therefore yields a *predicted / structural* read, labeled as such in
the UI — never a measured rate.

## RICE snapshot

RICE = (Reach × Impact × Confidence) / Effort. Reach = est. uses/quarter
(anchored ~200 analysis sessions/qtr — soft; rescale to real usage). Impact
0.25–3. Effort in person-days.

| # | Feature | Reach | Impact | Conf | Effort | RICE |
|---|---------|------:|-------:|-----:|-------:|-----:|
| 1 | Market Pulse label fix | 100 | 1 | 90% | 1 | 90 |
| 2 | Competitor new-winner alerts | 150 | 2 | 70% | 6 | 35 |
| 3 | AI Concept Generator | 120 | 3 | 70% | 8 | 31 |
| 4 | Variant grouping (via phashionGroup) | 200 | 1 | 70% | 3 | 47 |
| 5 | Side-by-side compare | 60 | 2 | 70% | 5 | 17 |
| 6 | Week-over-week trend | 80 | 2 | 60% | 7 | 14 |
| 8 | Frame-level hook breakdown | 80 | 2 | 60% | 3* | 32* |
| — | Video foundation + slide-14 overhaul | — | 3 | 60% | 8 | — |

\* #8 effort/confidence assume the video foundation already exists.

## Build sequence

`#1` → `video foundation + overhaul` → `#8` → `#3` → `#2` → `#4` → `#5` → `#6`.

Rationale: #1 is a near-free quick win; the video foundation is the stated
priority and enriches `CreativeTag`, which #3/#5/#6 all consume; #8 is the
on-demand surface of the same engine. #2's placement depends on the delivery
channel decision below.

---

## Shared foundation — multimodal video ingestion

For each creative to deep-analyze: download `mediaUrl` in the function and pass
the bytes to Gemini as an **`inlineData`** part — no GCS. Vertex can't fetch
Sensor Tower's external HTTP `mediaUrl` directly, and its other option (`gs://`
`fileData`) would need a bucket + service-agent IAM + cleanup; inline avoids all
of that. Short UA creatives sit well under Vertex's ~20 MB inline request cap;
oversize videos (>~12 MB raw) are skipped (non-fatal). **Tier it (DECIDED):** the
batch job video-analyzes only the **top 10 ranked winners shown in the UI**
(video format; the `rank <= 10` set) per workspace-week; everything else stays
metadata-tagged. Deep per-video (#8) is on-demand in the detail modal.

## Video foundation v2 — GCS `fileData` for oversize videos (SCOPED)

**Why:** inline `inlineData` is capped by Vertex's ~20 MB request limit → raw
video must be ≤ ~14.5 MB (on-demand) / 12 MB (batch). Real UA creatives blow
past this: one tracked advertiser ("Tiles in Hole", `67dcb3c1af0c1ca713c96b38`)
has 119 s videos at ~19.4 MB and a cluster of 30 s videos at ~14 MB. Those can
only be analyzed by pointing Vertex at a `gs://` URI (`fileData`), which lifts
the limit to GCS-file scale (well beyond our needs). This is the tier the
original foundation deferred to dodge bucket + service-agent IAM + cleanup.

**Approach — tiered, inline-first (no regression):**
1. Download bytes + measure (as today).
2. `≤ inline ceiling` → inline `inlineData` (current fast path, no GCS touched).
3. `> ceiling and ≤ hard cap` → upload to GCS, call Vertex with
   `fileData: { fileUri: 'gs://…', mimeType }`, analyze.
4. `> hard cap` → skip with the clear reason we now surface.

**Concrete bindings (this project):**
- **Bucket:** new `companalysis-creative-cache` (or reuse the default app bucket)
  with an **object lifecycle rule: delete after 1 day** — cleanup is automatic
  and race-free, so no explicit delete in the hot path. Path
  `creative-video-cache/{week}/{creativeId}.mp4`.
- **IAM (the deferred cost, one-time):**
  - Function runtime SA `907562912125-compute@developer.gserviceaccount.com` →
    `roles/storage.objectAdmin` on the bucket (upload).
  - **Vertex AI Service Agent**
    `service-907562912125@gcp-sa-aiplatform.iam.gserviceaccount.com` →
    `roles/storage.objectViewer` on the bucket (Vertex, not the function, reads
    the `gs://` URI — this is the extra grant inline avoided).
- **Code:** add `stageVideoToGcs()` beside `videoFetch.ts`; a `fileData` variant
  of `vertexVideoGenerate` (fileUri instead of base64); a size branch in the
  `analyzeWinnerVideos` worker. Everything stays non-fatal.

**Open sub-decisions (see Open decisions):** dedicated vs default bucket; does
the *batch* pass also use GCS or stay inline-only to bound cost; lifecycle-only
cleanup vs explicit delete. **Effort:** ~1–2 days; risk is mostly the Vertex-SA
IAM grant + `fileData` mime handling, not the code.

## Video-analysis overhaul (slide 14 → the prompt)

Rewrite `buildCreativePrompt` around the **Iteration Loop** anatomy + the
**game-motivations** taxonomy (deck slide 4). New per-creative structured output:

- **Segments** — `attention (0–3/5s)`: opening + hook mechanic + attention
  strength (1–5); `content (10–15s)`: mechanics, visual/animation/color notes,
  pacing, hold-risk; `end (2–5s)`: end twist, CTA, store logo, motivation closure.
- **Hook type** — existing 11-label taxonomy, now grounded in the video.
- **Motivations** — 1–3 from: Action, Achievement, Mastery, Social, Creativity,
  Destruction, Completion, Challenge, Competition, Design, Excitement, Power,
  Strategy, Collaboration, Discovery.
- **Iterable elements present** — slide checklist (hand pointer, captions, zoom,
  UGC, VO, end twist, store logo, …) → feeds concept/iteration briefs (#3).
- **Predicted hook / hold strength** (1–5, explicitly a prediction).

Stored additively as `videoAnalyses[]` on the insight doc (separate from the
metadata-only `creativeTags`), so nothing regresses. Consumed by the detail
modal (#8) and, later, the filter rail (filter by motivation / element).

**Runtime notes:** no GCS, no extra IAM — the function just needs outbound HTTP
to the Sensor Tower CDN (it already fetches ST) and Vertex AI enabled (already
used). Cost: ≤10 short videos × 1 Gemini video call per workspace analysis. The
whole pass is non-fatal — any download/parse failure is skipped and the insight
doc still writes.

---

## Feature detail

### #1 — Market Pulse label fix (SHIPPED)
`parseMarketPulseResponse` matches Gemini's echoed `label` exactly against cluster
labels; the echo never matches, so every rising concept falls back to its raw
label with an empty description (`WeeksReadBand` rising card + `MarketPulsePanel`).
**Fix:** number clusters in the prompt and have Gemini return the array `index`;
match by index, keep case-insensitive label as fallback. Add `geminiClient.test.ts`.

### #8 — Frame-level hook breakdown (SHIPPED)
On-demand "Deep-analyze this video" in `CreativeDetailModal` → renders the segment
timeline from the shared engine. Small once the foundation exists.

### #3 — AI Creative Concept Generator (SHIPPED)
"Make 3 concepts" → Gemini takes winning hooks/motivations/iterable-elements +
the focus game's gaps + focus-game metadata → a structured concept mapped onto
the deck's **Video Brief** template (Concept+Motivation / Hook / Visual style /
Intro-Gameplay-End / Length / References). Extends `frontend/src/lib/creativeBrief.ts`.

### #2 — Competitor new-winner alerts
Diff the weekly-refresh output per workspace; a new creative crossing the winner
threshold → digest. **OPEN DECISION: delivery channel.** No email/Slack infra
exists; simplest is piggybacking the morning-briefing flow. Effort hinges on this.

### #4 — Creative variant grouping (SHIPPED)
Client-side `groupBy(phashionGroup)`; one tile + network/country/variant badges.
Declutters the gallery and makes SoV/longevity honest.

### #5 — Side-by-side compare (SHIPPED)
Select 2 tiles → diff panel (hook / segments / motivations / why-it-wins);
"my game vs winning pattern" preset. Best after the overhaul (richer fields).

### #6 — Per-workspace week-over-week trend (SHIPPED)
Dedicated **Trends modal** off a header button. `useWorkspaceTrend(scopeId)` reads
the accumulated weekly insight docs (`creativeInsights` where `genreId == scopeId`,
newest-first — reuses the existing `genreId + generatedAt` index). `buildCompositionTrend`
turns them into per-hook and per-motivation share-over-time series with WoW deltas
+ top movers; `buildFatigue` reads the current week's creatives for weeks-live
(from `durationDays`, variant-collapsed, winners-first). Fatigue works off one
analyzed week; composition needs ≥2 weeks and degrades to a "N week(s) so far"
note until history accrues. All pure logic in `frontend/src/lib/creativeTrend.ts`.
Labeled a structural read (no measured rates). Verified: `tsc` + eslint clean,
Vite transform of all modules, and 20 synthetic-data assertions on the pure
aggregation (frontend has no test runner, so no committed unit test).

### Dismiss suggested competitors (SHIPPED)

Removing a competitor already works (the ✕ in `CompetitorRail` → `removeCompetitor`
in `Creatives.tsx`, persisted to the workspace doc). The gap: `runDiscovery` does
`setCompetitors(found)`, which **overwrites** the list, so a competitor the user
deliberately removed **reappears** on the next AI discovery / ↻ refresh. There is
no dismissal that discovery respects.

**Fix:** a per-workspace `dismissedAppIds` blocklist on the `GameWorkspace` doc.
`removeCompetitor` adds to it; `runDiscovery` filters `found` against it before
`setCompetitors`. Add an "undo / manage dismissed" affordance so it's reversible
(and so a re-added competitor isn't silently dropped forever). Small, client-side
+ one workspace field. Effort ~0.5–1 day.

Follow-up shipped: a **"✨ Suggest more"** action in the Edit-set drawer re-runs
AI discovery and APPENDS only new picks (keeps the curated set; skips present +
dismissed). Removal itself stays the hover-✕ on each card in that drawer.

## Open decisions

- **Alerts delivery channel** (#2): email vs Slack vs morning-briefing piggyback.
- **GCS v2 — bucket:** dedicated `companalysis-creative-cache` vs reuse the
  default app bucket.
- **GCS v2 — batch scope:** does the top-10 batch pass also stage oversize videos
  to GCS, or stay inline-only (cap cost/latency) with on-demand-only GCS?
- **GCS v2 — cleanup:** lifecycle-rule-only (simplest) vs explicit post-analysis
  delete.
- **Slide reference:** "slide 14" read as deck section **#7 Iteration Loop**
  (cover + dividers counted). Confirm if the deck numbers differently.

## Resolved decisions

- **Video-analysis tier (2026-07-28):** batch job analyzes the top 10 ranked
  winners shown in the UI (video format), per workspace-week.
- **Delivery process:** features built one at a time, committed individually.
