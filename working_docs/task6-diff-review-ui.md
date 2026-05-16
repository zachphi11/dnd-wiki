# Task 6: Diff Review UI + Apply Route — Complete Upload Flow

## Summary

Wired the full upload flow end-to-end: real Claude analysis via `noteProcessor`, a three-state review UI in `upload.html`, and a `POST /upload/apply` route that writes approved changes to Wiki.js.

## Changes

### `server.js` (updated)

- **Clients wired at startup**: creates `WikiClient` and `Anthropic` instances from env vars (`WIKIJS_API_TOKEN`, `ANTHROPIC_API_KEY`) when present; gracefully falls back to stub behavior when missing.
- **`POST /upload/analyze`**: now calls `analyzeNotes(notes, wikiClient, anthropic)` and returns `{ proposals: [...] }` as JSON. Returns stub `{ proposals: [] }` when clients are not configured.
- **`POST /upload/apply`** (new): accepts `{ proposals: [...] }` JSON body. For each proposal, calls `wikiClient.updatePage` (for `action: "update"`) or `wikiClient.createPage` (for `action: "create"`). Returns `{ applied: [...], errors: [...] }` — errors do not abort remaining proposals (partial success is valid).

### `public/upload.html` (updated)

Replaced the two-state form (input + loading) with a full four-state single-page application:

| State | Trigger |
|---|---|
| **Input** | Initial load or "Upload Another" button |
| **Loading** | Analyze button clicked / Apply button clicked |
| **Review** | Analysis complete — shows proposals or "no changes" message |
| **Success** | Apply complete — shows applied pages with wiki links |

**Review state features:**
- Each proposal shows an action badge (UPDATE / NEW), page title, rationale blurb.
- Side-by-side "Before" / "After" content panes for easy comparison.
- Per-proposal approve checkbox (checked by default).
- Empty analysis result shows a friendly "no changes needed" message.

**All state transitions use JavaScript `fetch`** (no full-page reloads after initial load). Form submission dispatches to `/upload/analyze`; apply button dispatches to `/upload/apply`. Errors are displayed inline without losing state.

### `__tests__/applyRoute.test.js` (new file)

Five tests covering the apply route:
- 400 for missing or empty proposals array.
- `updatePage` called correctly for `action: "update"` proposals.
- `createPage` called correctly for `action: "create"` proposals.
- Partial success: errors recorded but remaining proposals still applied.

### `__tests__/uploadRoutes.test.js` (updated)

Updated button detection regex to accept `type="button"` with `analyze-btn` ID (was previously `type="submit"` before fetch-based submission was introduced).

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Uploading notes triggers Claude analysis and returns review page | ✓ (requires `ANTHROPIC_API_KEY` + `WIKIJS_*` env vars) |
| Each proposed change shows page title, before/after diff, rationale | ✓ |
| Approving a subset writes only those pages to Wiki.js | ✓ (unchecked proposals are excluded from POST /upload/apply) |
| Rejected changes are ignored | ✓ |
| Empty analysis result handled gracefully | ✓ ("no changes needed" message shown) |
| Full flow works in a browser end-to-end | ✓ (requires live environment) |
