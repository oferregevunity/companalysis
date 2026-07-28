# Creatives — Feature Roadmap

**Date:** 2026-07-28
**Status:** In progress. **Shipped + deployed 2026-07-28:** #1, the video
foundation + slide-14 overhaul, and #8. **Next:** #3 (concept generator).
**Context:** Builds on the game-workspace flow ([design-game-competitor-analysis.md](design-game-competitor-analysis.md)).

## Progress

- [x] Roadmap doc
- [x] **#1 Market Pulse label fix** — deployed
- [x] **Video foundation + slide-14 overhaul** — inline-to-Vertex, top-10 videos
  by score; deployed; verified in prod
- [x] **#8 On-demand per-creative video analysis** — "Analyze this video" in the
  detail modal; deployed (`compAnalysisApi` + hosting)
- [ ] #3 AI Concept Generator (next — grounded in deck slide 15 Ideation Strategy)
- [ ] #2 Competitor new-winner alerts (blocked on delivery-channel decision)
- [ ] #4 Variant grouping
- [ ] #5 Side-by-side compare
- [ ] #6 Week-over-week trend

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

### #1 — Market Pulse label fix (IN PROGRESS)
`parseMarketPulseResponse` matches Gemini's echoed `label` exactly against cluster
labels; the echo never matches, so every rising concept falls back to its raw
label with an empty description (`WeeksReadBand` rising card + `MarketPulsePanel`).
**Fix:** number clusters in the prompt and have Gemini return the array `index`;
match by index, keep case-insensitive label as fallback. Add `geminiClient.test.ts`.

### #8 — Frame-level hook breakdown
On-demand "Deep-analyze this video" in `CreativeDetailModal` → renders the segment
timeline from the shared engine. Small once the foundation exists.

### #3 — AI Creative Concept Generator
"Make 3 concepts" → Gemini takes winning hooks/motivations/iterable-elements +
the focus game's gaps + focus-game metadata → a structured concept mapped onto
the deck's **Video Brief** template (Concept+Motivation / Hook / Visual style /
Intro-Gameplay-End / Length / References). Extends `frontend/src/lib/creativeBrief.ts`.

### #2 — Competitor new-winner alerts
Diff the weekly-refresh output per workspace; a new creative crossing the winner
threshold → digest. **OPEN DECISION: delivery channel.** No email/Slack infra
exists; simplest is piggybacking the morning-briefing flow. Effort hinges on this.

### #4 — Creative variant grouping
Client-side `groupBy(phashionGroup)`; one tile + network/country/variant badges.
Declutters the gallery and makes SoV/longevity honest.

### #5 — Side-by-side compare
Select 2 tiles → diff panel (hook / segments / motivations / why-it-wins);
"my game vs winning pattern" preset. Best after the overhaul (richer fields).

### #6 — Per-workspace week-over-week trend
Aggregate accumulated weekly insight docs for the competitor set: hook/motivation
share over time + creative-fatigue (weeks-live). Needs ≥2–3 weeks of history.

## Open decisions

- **Alerts delivery channel** (#2): email vs Slack vs morning-briefing piggyback.
- **Slide reference:** "slide 14" read as deck section **#7 Iteration Loop**
  (cover + dividers counted). Confirm if the deck numbers differently.

## Resolved decisions

- **Video-analysis tier (2026-07-28):** batch job analyzes the top 10 ranked
  winners shown in the UI (video format), per workspace-week.
- **Delivery process:** features built one at a time, committed individually.
