# Screen: Game Competitor Analysis (Creatives page, game-first flow)

**Date:** 2026-07-16
**Status:** Draft — under discussion

## Purpose

A game designer / creative manager picks **any** game (live Sensor Tower search),
gets its real competitors (live API), sees their currently-running top creatives,
and gets AI insight into what's working (hook types, themes) — with everything
cached in our DB so the second visit is instant and costs zero Sensor Tower calls.

This replaces the genre-week mental model with a **game workspace**: the unit of
analysis is "this game + its competitor set + this week".

## Entry points

- `/creatives` — the search hero is the first thing on the page (exists today).
- A **"Recent games"** row under the search: workspaces the team analyzed before
  (one chip per game, with icon + "analyzed 2d ago"). One click restores everything
  from Firestore — this is the "saved for next time" made visible.

## The flow (4 steps, one screen)

```
1. SELECT GAME      2. CURATE COMPETITORS       3. ANALYZE                 4. EXPLORE
Search ST catalog → Top-by-revenue rail,      → One CTA kicks pipeline:  → Gallery + hooks/themes
pick your game      pre-checked top 10,         fetch → score → Gemini     scoped to this workspace
                    add/remove freely           (with live progress)
```

### Step 1 — Select game *(already live)*
Debounced Sensor Tower catalog search. Selecting a game creates/loads the workspace.

### Step 2 — Discover & curate competitors *(DECIDED: AI-powered discovery)*
Sensor Tower has no "related apps" API (verified against app metadata), so
discovery is a new **`apps/discover-competitors`** function route:

1. Pull the focus game's ST metadata (name, publisher, description, categories,
   downloads/revenue scale) — one API call, cached.
2. **Gemini** names the ~12 closest real competitors ("mobile games competing for
   the same players/UA audience"), grounded in that metadata.
3. Resolve each name → unified app id via the existing `searchUnifiedApps`;
   drop unresolvable ones.
4. **Backfill** with category top-by-revenue (existing `apps/competitors`) until
   ~20 candidates; Gemini picks ranked first, deduped.
5. Result cached on the workspace doc (and re-usable across teammates).

Rail UI: **top 10 pre-checked**, checkbox per card, source hint per card
("AI match" / "category top 10"), **"+ Add competitor"** opens the same game
search for manual additions. The curated set persists on the workspace.

### Step 3 — Analyze *(new pipeline, reuses existing engines)*
Primary CTA on the rail: **"Analyze creatives (11 games)"**.

Per app in the set (focus game + checked competitors):
1. **Cache check:** if `appCreativeWeeks/{appId}_{week}` exists → skip Sensor Tower,
   reuse stored creatives. This is the app+week-level cache — shared across
   workspaces and teammates, so overlapping competitor sets are nearly free.
2. Otherwise fetch that app's creatives across all tracked networks (~9 calls),
   store to `creativeLatest` + write the cache marker.

Then once per workspace:
3. Statistical scoring (existing engine) over the workspace's creative set.
4. Gemini insights (existing prompt, framed as "competitors of {game}" instead of
   a genre name): summary, winners, emerging concepts, watch list, hook/theme tags.

**Progress UI:** each competitor card shows its own state
(`queued → fetching… → ✓ 14 creatives` / `⚠ failed — retry`), and a slim stepper
above the gallery: `Fetching 4/11 → Scoring → AI analysis`. The client orchestrates
one function call per app (bounded concurrency ≈ 3) — no 540s timeout risk, and
progress is real, not simulated.

### Step 4 — Explore *(existing components, rescoped)*
Same AI summary strip, HookThemePanel, filters, and gallery — but reading the
workspace's insight doc instead of a genre's. Competitor cards double as gallery
filters (exists today). "Analyzed 2h ago · **Refresh**" replaces the current
re-analyze button; Refresh invalidates this week's cache markers for the set.

## Data model (new collections, existing shapes)

```
gameWorkspaces/{focusAppId}
  focusApp: SearchedGame          # snapshot — game may not be in our DB otherwise
  competitors: CompetitorRow[]    # curated set, denormalized (name/icon/revenue)
  country: string                 # from focus game's top market, default US
  lastAnalyzedWeek: string
  createdBy / updatedAt

appCreativeWeeks/{appId}_{week}   # app-level fetch cache marker (the big cost saver)
  fetchedAt, creativeCount

gameCreativeInsights/{focusAppId}_week_{week}      # CreativeInsightDoc, unchanged shape
  └─ scores/{docId}                                # CreativeScoreRow, unchanged shape

creativeLatest/{appId__creativeKey}                # existing collection, shared store
```

Reuse, not fork: `scoringPipeline` and `creativeInsights/pipeline` take a scope id —
`{genreId}` today, `game_{focusAppId}` here. The genre weekly job keeps writing the
same collections it does now; genre fetches also write `appCreativeWeeks` markers so
the two pipelines share the cache.

## Layout

### Header
- Title: "Creatives"
- Right: "Analyzed {timeAgo} · Refresh" (workspace mode) — replaces "Re-analyze this week"

### Main content order (game mode)
1. Game search hero / "Your game" chip *(exists)*
2. Recent games row *(new — chips from `gameWorkspaces`)*
3. Competitor rail with checkboxes + "+ Add competitor" + **Analyze CTA** *(upgrade)*
4. Progress stepper *(new, only while pipeline runs)*
5. AI summary / emerging concepts / watch list strip *(exists, rescoped)*
6. Hooks & themes panel *(exists, rescoped)*
7. Filters + creative gallery *(exists, rescoped)*

**DECIDED: genre mode is retired.** Genre pills, the genre selector, and the
genre-scoped creatives view are removed from `/creatives`; the page is game-first
only. The weekly *genre* creatives job is replaced by workspace auto-refresh
(below). Rising Stars (app-level genre insights) is untouched — only the
creatives page changes.

## States

| State | What the user sees |
|---|---|
| No game selected | Search hero + recent games; genre browse below |
| Game selected, never analyzed | Rail with pre-checked top 10 + big "Analyze creatives" CTA; gallery area shows explainer empty-state |
| Analyzing | Per-card progress + stepper; gallery fills in as scoring lands |
| Partial failure | Cards that failed show "⚠ retry"; insights run on what succeeded; banner lists failures |
| Analyzed (fresh) | Full results, "Analyzed 2h ago" |
| Analyzed (stale ≥7d) | Amber hint: "Data is from W28 — Refresh for this week" |
| Gemini failed | Statistical scores shown; amber banner with stored error + Retry analysis (fetch skipped via cache) |

## Cost guardrails

- One workspace analysis ≈ (uncached apps × 9) ST calls; 11 fresh apps ≈ 99 calls ≈ 1–3 min.
- Repeat analysis same week ≈ 0 fetch calls (cache markers) + 1 Gemini call.
- Client-side concurrency cap (3 apps at a time) keeps us under ST rate limits.

## Decisions (resolved 2026-07-16 with Ofer)

1. **Competitor discovery** — API/AI-driven: Gemini names true competitors from ST
   metadata, resolved via ST search, backfilled with category top-revenue.
   Pre-checked top 10, editable checkboxes, manual add via search.
2. **Genre mode** — retired now. Creatives page is game-first only; weekly genre
   creatives job replaced by workspace auto-refresh. Rising Stars unaffected.
3. **Weekly auto-refresh** — Sunday job re-fetches + re-analyzes workspaces
   touched in the last 30 days (piggybacks the app+week cache).
4. **Country** — US default with a per-workspace country picker in the rail
   (seeded from the game's `top_countries[0]` when available).

## Build plan (phased, each phase shippable)

1. **Backend** — `apps/discover-competitors` (Gemini + resolve + backfill);
   generalize app-week creative fetch with `appCreativeWeeks` cache markers;
   `games/analyze` (score + Gemini for a workspace set, scope id `game_{appId}`);
   Firestore rules for `gameWorkspaces` / new read paths.
2. **Frontend** — workspace state + Firestore persistence, discovery rail with
   checkboxes/add/country, per-app fetch orchestration with progress, rescope
   AI strip / hooks-themes / gallery to workspace docs, recent-games row,
   remove genre UI from the page.
3. **Scheduled** — Sunday job: refresh workspaces active in last 30 days;
   retire the genre creatives leg.
