# Saved Views & Sharing — Design

**Approach:** C — Shareable links (state-in-URL) + named saved presets in Firestore. Sharing like Google Drive: private, share with specific people, or anyone with the link.

---

## 1. Payload (what gets saved)

Same payload for URL state and saved presets. Dashboard only for v1.

| Field | Type | Notes |
|-------|------|--------|
| `genres` | string[] | Selected genre IDs |
| `sorting` | `{ id: string, desc: boolean }[]` | Table sort (column id + direction) |
| `globalFilter` | string | Search box |
| `sortMetric` | `'value' \| 'percent'` | Value vs % toggle |
| `rising` | string[] | Selected Rising badges |
| `risingThreshold` | number | e.g. 20 |
| `favoritesOnly` | boolean | Favorites-only filter |
| `dateFrom` / `dateTo` | string | Month/week range |
| `granularity` | `'month' \| 'week'` | |
| `metricView` | `'revenue' \| 'downloads'` | Tab |
| `pageSize` | number | Optional; default 50 |

Do **not** persist `pageIndex` — shared links open at page 1.

Genre Detail page: out of scope for v1.

---

## 2. URL design

- **State-in-URL:** Only include params that differ from defaults. Short keys: `g`, `s`, `q`, `sm`, `r`, `rt`, `fo`, `from`, `to`, `gr`, `mv`, `ps`. Arrays comma-separated; sort as `columnId:asc` or `columnId:desc`.
- **Preset link:** `?preset=<id>`. App fetches preset, checks permission, applies payload.
- **Rule:** If `preset` is present, load from preset and ignore other params; otherwise parse state from query params.

---

## 3. Firestore data model

**Collection:** `savedViews`

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | User-defined name |
| `payload` | map | Same shape as payload above |
| `ownerId` | string | Firebase Auth UID |
| `ownerEmail` | string | Optional; for "Shared by ..." |
| `visibility` | string | `'private'` \| `'shared'` \| `'anyone'` |
| `sharedWith` | string[] | For `'shared'`: UIDs (or emails resolved to UID) |
| `createdAt` | timestamp | Server timestamp |
| `updatedAt` | timestamp | Server timestamp |

**Rules:**

- **Private:** only `ownerId` can read/update/delete.
- **Shared:** `ownerId` + UIDs in `sharedWith` can read; only `ownerId` can update/delete. Resolve email→UID when adding by email.
- **Anyone:** anyone with the link can read (optionally without sign-in for `?preset=id`); only `ownerId` can update/delete.

Add indexes as needed for "my presets" and "shared with me" queries.

---

## 4. Sharing model (UI behavior)

- **Copy link:** Build URL with current payload (non-defaults only), copy to clipboard. No save; anyone with link sees same view.
- **Save view:** Modal with name, visibility (Only me / Specific people / Anyone with the link). "Specific people" = add by email; store as UIDs in `sharedWith`.
- **Opening preset:** `?preset=id` — if visibility is "anyone", allow read without sign-in; else require sign-in and check `ownerId` or `sharedWith`. On failure show clear error; do not apply partial state.
- **Shared with me:** List presets where current user's UID is in `sharedWith`; open applies payload and sets URL to `?preset=id`.

---

## 5. UI placement and flows

- **Toolbar:** Add "Copy link" and "Save view" on Dashboard (same area as Metric / Sort / Rising / Favorites). "Copy link" = single action; "Save view" = modal (name + visibility + optional share-with list).
- **Saved views list:** "Saved views" dropdown or menu: "My views" (ownerId === me), "Shared with me" (UID in sharedWith). Click item → apply preset, set URL to `?preset=id`. Optional: "Copy link" / "Delete" on own presets in list.
- **Load on mount:** If `?preset=id` → fetch preset, check access, apply payload. Else if query params present → parse and apply. Defaults for missing params.
- **Invalid/missing data:** If genre IDs in payload don't exist, apply what we can and optionally show a message; do not crash.

---

## 6. Out of scope for v1

- Genre Detail page share/save.
- "Anyone (listed)" gallery where any signed-in user can browse all public presets.
- Editing preset name/visibility after creation (can be added later).
