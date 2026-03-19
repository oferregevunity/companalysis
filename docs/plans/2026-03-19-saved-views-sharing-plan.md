# Saved Views & Sharing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Users can share Dashboard filter/sort state via a link (state-in-URL or preset id) and save named presets with sharing options (private, specific people, anyone with link).

**Architecture:** Payload is serialized to/from URL query params; saved presets stored in Firestore `savedViews` with owner, visibility, and optional sharedWith UIDs. Dashboard reads URL on load (preset wins over state params); "Copy link" and "Save view" in toolbar; "Saved views" dropdown to open presets. Backend API for create preset and invite-by-email (resolve UID); get preset via Firestore from client (rules enforce access).

**Tech Stack:** React, TanStack Table, Firebase Auth, Firestore, Vite; Firebase Functions (compAnalysisApi) for create/invite.

**Design reference:** `docs/plans/2026-03-19-saved-views-sharing-design.md`

---

## Task 1: Payload type and URL serialization (frontend)

**Files:**
- Create: `frontend/src/types/savedView.ts`
- Create: `frontend/src/lib/savedViewUrl.ts`

**Step 1: Define payload type and URL key map**

In `frontend/src/types/savedView.ts`:

```ts
export type SavedViewPayload = {
  genres: string[];
  sorting: { id: string; desc: boolean }[];
  globalFilter: string;
  sortMetric: 'value' | 'percent';
  rising: string[];
  risingThreshold: number;
  favoritesOnly: boolean;
  dateFrom: string;
  dateTo: string;
  granularity: 'month' | 'week';
  metricView: 'revenue' | 'downloads';
  pageSize: number;
};

export const DEFAULT_PAYLOAD: SavedViewPayload = {
  genres: [],
  sorting: [],
  globalFilter: '',
  sortMetric: 'value',
  rising: [],
  risingThreshold: 20,
  favoritesOnly: false,
  dateFrom: '',
  dateTo: '',
  granularity: 'month',
  metricView: 'revenue',
  pageSize: 50,
};
```

**Step 2: Implement serialize payload → query string**

In `frontend/src/lib/savedViewUrl.ts`: implement `payloadToQueryString(payload: SavedViewPayload): string` using short keys (`g`, `s`, `q`, `sm`, `r`, `rt`, `fo`, `from`, `to`, `gr`, `mv`, `ps`). Omit keys that match defaults. Arrays comma-separated; sorting as `id:asc` or `id:desc` (one segment per sort, e.g. `s=col1:desc,col2:asc`). Use `encodeURIComponent` for values.

**Step 3: Implement parse query string → payload**

In same file: `queryStringToPayload(search: string): Partial<SavedViewPayload>` — parse `URLSearchParams`, map keys back, split arrays, merge with `DEFAULT_PAYLOAD` so result is full `SavedViewPayload`.

**Step 4: Add helpers**

- `buildAppUrl(payload: SavedViewPayload, presetId?: string): string` — origin + pathname + `?preset=id` if presetId else `?` + payloadToQueryString(payload).
- `getPresetIdFromSearch(search: string): string | null` — return `preset` param or null.

**Step 5: Commit**

```bash
git add frontend/src/types/savedView.ts frontend/src/lib/savedViewUrl.ts
git commit -m "feat: saved view payload type and URL serialization"
```

---

## Task 2: Firestore rules for savedViews

**Files:**
- Modify: `firestore.rules`

**Step 1: Add savedViews rules**

After the `favorites` block, add (using existing `isUnityUser()`):

```
match /savedViews/{viewId} {
  allow read: if resource.data.visibility == 'anyone'
    || (isUnityUser() && (resource.data.ownerId == request.auth.uid
        || request.auth.uid in resource.data.get('sharedWith', [])
        || resource.data.visibility == 'anyone'));
  allow create: if isUnityUser() && request.resource.data.ownerId == request.auth.uid;
  allow update, delete: if isUnityUser() && resource.data.ownerId == request.auth.uid;
}
```

Unauthenticated read only when `visibility == 'anyone'`.

**Step 2: Deploy rules (optional in plan)**

```bash
firebase deploy --only firestore:rules
```

**Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat: Firestore rules for savedViews (private, shared, anyone)"
```

---

## Task 3: Backend API — create preset and invite by email

**Files:**
- Modify: `functions/src/index.ts` (add routes)
- Modify: `frontend/src/lib/api.ts` (add api.savedViews.*)

**Step 1: Add savedViews/create route**

In `compAnalysisApi` switch, add case `'savedViews/create'`: body `{ name, payload, visibility, sharedWithEmails? }`. Require auth. Validate payload shape (genres array, etc.). Create doc in `companalysis` db collection `savedViews` with `name`, `payload`, `ownerId`, `ownerEmail`, `visibility`, `sharedWith` (array of UIDs — resolve sharedWithEmails via `admin.auth().getUserByEmail(email)` and collect UIDs), `createdAt`, `updatedAt` (server timestamp). Return `{ id: ref.id }`.

**Step 2: Add savedViews/invite route**

Case `'savedViews/invite'`: body `{ presetId, email }`. Require auth. Get preset doc; verify `resource.data.ownerId == auth.uid`. Resolve email to UID; append to `sharedWith` (no duplicates). Update doc. Return `{ success: true }`.

**Step 3: Frontend api.ts**

Add `api.savedViews.create(...)` and `api.savedViews.invite(presetId, email)` calling `/api/savedViews/create` and `/api/savedViews/invite`.

**Step 4: Commit**

```bash
git add functions/src/index.ts frontend/src/lib/api.ts
git commit -m "feat: API create preset and invite by email"
```

---

## Task 4: Dashboard — read URL on load and apply state

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Import and read URL**

Use `useSearchParams()` (react-router-dom) or `window.location.search`. On mount (useEffect): if `getPresetIdFromSearch(search)` is set, fetch preset doc from Firestore (`getDoc(doc(db, 'savedViews', id))` — use `companalysis` db). If fetch fails or no access, show toast or inline message "Link invalid or no access", clear preset from URL (replaceState). If success, apply `payload` to state (setSelectedIds from payload.genres, setSorting, setGlobalFilter, etc.). If no preset id but query params present, call `queryStringToPayload(search)` and apply. Ensure genres that don’t exist are dropped when applying.

**Step 2: Initialize state from payload helper**

Create a function `applyPayloadToState(payload: SavedViewPayload, setters, genres)` that maps payload to existing state setters and genre ids that exist in `genres`. Call it from the URL-load effect.

**Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: Dashboard load filters/sort from URL (preset or state params)"
```

---

## Task 5: Copy link button

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Build payload from current state**

Create a `getCurrentPayload()` (or inline) that reads current Dashboard state (selectedIds, sorting, globalFilter, sortMetric, selectedRising, risingThreshold, showFavoritesOnly, dateFrom, dateTo, granularity, metricView, pageSize) and returns `SavedViewPayload`.

**Step 2: Add Copy link button**

In the toolbar, add a button "Copy link". On click: `const url = buildAppUrl(getCurrentPayload()); await navigator.clipboard.writeText(url);` then show a short toast "Link copied".

**Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: Copy link to current view"
```

---

## Task 6: Save view modal

**Files:**
- Create: `frontend/src/components/SaveViewModal.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Modal component**

SaveViewModal receives: `open`, `onClose`, `initialPayload` (current state), `onSaved(id?: string)`. Form: name (required), visibility select (Only me / Share with specific people / Anyone with the link). If "Share with specific people", show a list input to add emails (and call api.savedViews.invite after create for each). On submit: call `api.savedViews.create({ name, payload: initialPayload, visibility, sharedWithEmails })`. On success call `onSaved(id)` and close; optionally copy preset link to clipboard.

**Step 2: Wire in Dashboard**

Add state `saveViewModalOpen`; "Save view" button sets it true and passes current payload. On save success, optionally set URL to `?preset=id` and show "Saved" feedback.

**Step 3: Commit**

```bash
git add frontend/src/components/SaveViewModal.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat: Save view modal with name and visibility"
```

---

## Task 7: Fetch my views and shared-with-me

**Files:**
- Create: `frontend/src/hooks/useSavedViews.ts`

**Step 1: useSavedViews hook**

- `useSavedViews()`: if not signed in return `{ myViews: [], sharedWithMe: [], loading: false }`. Else run two queries on `db`: (1) `collection(db, 'savedViews')` where `ownerId == auth.uid`; (2) where `sharedWith` array-contains `auth.uid`. Import `db` from `../lib/firebase` (already companalysis). Return `{ myViews, sharedWithMe, loading, error }` with snapshot listeners or one-time get.

**Step 2: Commit**

```bash
git add frontend/src/hooks/useSavedViews.ts
git commit -m "feat: useSavedViews hook for my views and shared with me"
```

---

## Task 8: Saved views dropdown in toolbar

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Add dropdown**

Use `useSavedViews()`. Add a "Saved views" dropdown (or menu) in the toolbar. Sections: "My views" (myViews) and "Shared with me" (sharedWithMe). Each item shows name (and optional "Shared by email" for shared). On click: apply that preset’s payload via `applyPayloadToState`, then set URL to `?preset=<id>` (replaceState or navigate).

**Step 2: Optional actions**

For own presets in the list, add "Copy link" and "Delete" (delete: remove doc from Firestore; then refresh list). Out of scope for minimal: edit name/visibility.

**Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: Saved views dropdown to open and apply preset"
```

---

## Task 9: Handle preset not found / no access

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Error UX**

When loading `?preset=id`: if getDoc fails or document doesn’t exist, show a small inline message near the toolbar ("This link is invalid or you don’t have access") and remove `preset` from the URL so the user isn’t stuck. When visibility is "anyone", use client getDoc (no auth); rules allow read. When visibility is private/shared, user must be signed in; rules enforce owner/sharedWith.

**Step 2: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "fix: handle invalid or inaccessible preset link"
```

---

## Task 10: Use existing db in useSavedViews

**Files:**
- Modify: `frontend/src/hooks/useSavedViews.ts`

**Step 1: Import db from firebase**

Use the existing `db` export from `../lib/firebase` (already configured for `companalysis`). No change to firebase.ts needed.

**Step 2: Commit**

```bash
git add frontend/src/hooks/useSavedViews.ts
git commit -m "chore: use companalysis Firestore for savedViews"
```

---

## Execution handoff

After saving the plan, offer:

**Plan complete and saved to `docs/plans/2026-03-19-saved-views-sharing-plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with executing-plans and run with checkpoints.

**Which approach?**
