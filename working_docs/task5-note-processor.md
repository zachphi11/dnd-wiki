# Task 5: noteProcessor — Two-Phase Claude Analysis + Unit Tests

## Summary

Created `noteProcessor.js` implementing two-phase Claude Haiku analysis of D&D session notes, along with a full unit test suite using mocked clients.

## Changes

### `noteProcessor.js` (new file)

Exports `analyzeNotes(notes, wikiClient, anthropic)`.

**Phase 1 — Identify affected pages:**
- Calls `wikiClient.listPages()` to get the full page list.
- Sends notes + page list to Claude with a `cache_control: { type: 'ephemeral' }` block on the page list so subsequent calls in a session hit the prompt cache.
- Claude returns `{ affected_page_ids: [...] }`. If the array is empty, the function returns `[]` immediately (no phase 2 call).

**Phase 2 — Generate proposals:**
- Fetches current content for each affected page ID via `wikiClient.getPage(id)`.
- Sends notes + page content to Claude.
- Claude returns an array of proposals shaped as `{ action, pageId, slug, title, current_content, proposed_content, rationale }`.

**Error handling:**
- `parseJSON(text, phase)` wraps `JSON.parse` and throws a labelled error (`"Phase 1 returned invalid JSON: ..."`) so callers get a clear message on malformed responses.

### `__tests__/noteProcessor.test.js` (new file)

Eight unit tests covering:

| Scenario | Verified |
|---|---|
| No affected pages → empty array returned, phase 2 not called | ✓ |
| One affected page → one proposal returned | ✓ |
| Multiple affected pages → multiple proposals, `getPage` called N times | ✓ |
| Phase 2 not called when phase 1 returns empty list | ✓ |
| Phase 1 uses `cache_control` on the page list block | ✓ |
| `current_content` in proposal matches what `wikiClient.getPage` returned | ✓ |
| Malformed JSON in phase 1 → clear error thrown | ✓ |
| Malformed JSON in phase 2 → clear error thrown | ✓ |

All tests mock both `wikiClient` and the `anthropic.messages.create` method — no real API calls.

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| `analyzeNotes` returns `[{ pageId, current_content, proposed_content, rationale }]` | ✓ (also includes `action`, `slug`, `title`) |
| Phase 1 uses `cache_control` on page-list block | ✓ verified in test |
| Phase 2 only called for pages identified in Phase 1 | ✓ verified in test |
| Unit tests pass with mocked responses: no affected pages, one, multiple | ✓ |
| Module importable by proxy server | ✓ `module.exports = { analyzeNotes }` |
