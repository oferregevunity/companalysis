# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A mobile-game competitor-analysis tool for the Unity/Supersonic team. It pulls Sensor Tower
market data (app rankings, revenue/downloads, ad creatives), runs Gemini over it, and serves a
React dashboard. Two product surfaces share one backend:

- **Dashboard / genre-week model** (`/`, `/genre/:id`, `/insights`) — the original flow: track
  configured *genres*, fetch top apps per week/month, AI-score "rising stars".
- **Creatives / game-workspace model** (`/creatives`) — the newer flow: search *any* game,
  AI-discover its competitor set, fetch their running ad creatives, analyze hooks/themes/videos.
  See [design-game-competitor-analysis.md](design-game-competitor-analysis.md) and
  [design-creatives-roadmap.md](design-creatives-roadmap.md) for intent and current status.

## Layout

Three independent npm packages, **no root `package.json`** — run npm commands inside each dir:

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4, Firestore client, React Router.
- `functions/` — Firebase Functions v2 (Node 20, TypeScript, CommonJS). Builds to `functions/lib/`.
- `scripts/` — standalone TS backfill/verify scripts run with `npx tsx` / `ts-node`.

## Commands

Frontend (`cd frontend`):
- `npm run dev` — Vite dev server on port 5173 (also `.claude/launch.json`).
- `npm run build` — `tsc -b && vite build` → `frontend/dist`.
- `npm run lint` — ESLint.

Functions (`cd functions`):
- `npm run build` — `tsc` → `lib/`.
- `npm test` — Vitest (`vitest run`, ~25 `*.test.ts` files).
- `npm run test:watch` — Vitest watch.
- Single test: `npx vitest run src/creativeInsights/pipeline.test.ts` or filter by name: `npx vitest run -t "scores creatives"`.
- `npm run serve` — build + Firebase emulators (functions only).

## Deploy — READ THIS FIRST

**The Firebase project `supersonic-291210` is SHARED with other apps** (notably `asoapi`).
A bare `firebase deploy` would delete/modify functions this repo doesn't own.

**Always deploy with [scripts/deploy-prod.sh](scripts/deploy-prod.sh)** (allowed via
`bash scripts/deploy-prod.sh`). It builds the frontend, then deploys *only* this app's targets
by name: `hosting,firestore,functions:compAnalysisApi,functions:weeklyFetchApps,functions:weeklyFetchCreatives`.
If you deploy functions manually, deploy them **by name** and never let Firebase prune others.

## Backend architecture

**One HTTP function, `compAnalysisApi`** ([functions/src/index.ts](functions/src/index.ts)) — a
monolithic path-based router (`switch (path)` over `genres/*`, `fetch/*`, `apps/*`, `games/*`,
`creatives/*`, `savedViews/*`, `insights/*`, `marketPulse/run`, …). There are no per-route
functions. The frontend calls everything through `POST /api/{path}` via `apiCall()`
([frontend/src/lib/api.ts](frontend/src/lib/api.ts)); Firebase Hosting rewrites `/api/**` to this
function. To add an endpoint: add a `case` in the router, then a wrapper in the `api` object.

**Auth:** Firebase Google sign-in restricted to `@unity3d.com` (`hd` param + `firestore.rules`).
The client sends a Bearer ID token; the function verifies it, **except** when the request arrives
via a Hosting domain (`isHostingRequest`), which is already same-origin authenticated.

**Firestore is a *named* database, `companalysis` (not `(default)`).** Server code must use
`getFirestore('companalysis')`; the client uses `initializeFirestore(app, …, 'companalysis')`.
**Clients read but never write** — nearly every collection is `allow write: if false` in
[firestore.rules](firestore.rules). All writes go through the Admin SDK in functions. Key
collections: `genres`, `snapshots/*`, `genreAggregates` (pre-pivoted dashboard read model),
`insights/*`, `creativeSnapshots/*`, `creativeLatest`, `creativeInsights/*`, `gameWorkspaces`,
`marketPulse`, `fetchLogs`, `savedViews`, `watchlist`.

**Scheduled jobs** (`functions/src/scheduled/weeklyFetch.ts`, exported from `index.ts`):
`weeklyFetchApps`, `weeklyFetchCreatives`, `weeklyFetchCreativesFallback`, `weeklyMarketPulse` —
Monday mornings ET. They are **resumable**: each run writes progress to a `fetchLogs` doc and
bails at a `TIME_BUDGET_MS` under the function timeout, resuming from prior progress on retry.

**External services:**
- **Sensor Tower** (`functions/src/sensorTower/`, `functions/src/adIntel/`) — market + ad-intel
  data. Auth via secret `SENSOR_TOWER_AUTH_TOKEN` (`defineSecret`). Client has retry/backoff and
  rate-limit handling; respect it rather than calling the API ad hoc.
- **Vertex AI Gemini** (`model: 'gemini-2.5-flash'`, region `us-central1`) — every `geminiClient.ts`
  under `insights/`, `creativeInsights/`, `concepts/`, `marketPulse/`. Project id comes from
  `GCLOUD_PROJECT`/`GCP_PROJECT` at runtime.

## Frontend conventions

- Data flows through **hooks** (`frontend/src/hooks/use*.ts`) that subscribe to Firestore or call
  `api`, and pure logic lives in **`frontend/src/lib/*.ts`** (e.g. `creativeTrend`, `creativeGaps`,
  `creativeVariants`, `dataProcessing`) — kept separate so it's unit-testable and reused across
  components. Prefer adding logic to `lib/` and rendering in components, matching existing files.
- Firestore client uses an IndexedDB persistent cache (`firebase.ts`); repeat visits serve from
  cache first — weekly-fetched data rarely changes, so this is intentional.

## Notes

- `functions/tsconfig.json` excludes `*.test.ts` from the build; `strict` + `noUnusedLocals` +
  `noImplicitReturns` are on, so unused imports/vars fail `npm run build`.
- Vite has no `/api` proxy, so local frontend API calls resolve against the emulator or the
  deployed backend, not a bare `npm run dev` alone.
