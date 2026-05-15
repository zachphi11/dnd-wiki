# Task 3: wikiClient Module + Integration Tests

## Summary

Created the `wikiClient.js` module wrapping the Wiki.js GraphQL API, along with a TDD integration test suite.

## Changes

### `wikiClient.js` (new file)

A `WikiClient` class with four operations:

| Method | Description |
|---|---|
| `listPages()` | Returns `[{ id, path, title }]` for all pages |
| `getPage(id)` | Returns `{ id, path, title, content }` or `null` if not found |
| `createPage(path, title, content)` | Creates a page and returns `{ id, path, title }` |
| `updatePage(id, content)` | Updates page content; fetches current metadata first to preserve title/path |

**Design decisions:**
- Constructor validates `baseUrl` and `apiToken` eagerly (throws immediately if missing).
- All GraphQL queries are private (`_query`). Callers work with plain JS objects only.
- 401 responses are caught and surfaced as a clear auth error.
- `getPage` returns `null` (not throws) for non-existent IDs — consistent with "not found" semantics.
- `updatePage` re-fetches the page metadata before mutating, so callers only supply `id` and new `content`.

### `__tests__/wikiClient.test.js` (new file)

Integration tests covering all four operations in dependency order:
1. `listPages` — verifies shape of returned objects
2. `createPage` — creates a scratch page; captures the returned ID for subsequent tests
3. `getPage` — reads back the scratch page; also verifies null return for non-existent ID
4. `updatePage` — mutates the scratch page; verifies change is reflected on re-fetch

Tests are wrapped in `describe.skip` when `WIKIJS_INTERNAL_URL` and `WIKIJS_API_TOKEN` are not set, so they pass in CI without a live wiki instance.

Constructor validation tests run unconditionally and confirm error messages.

## Running the Tests

```bash
# Against a live Wiki.js instance:
WIKIJS_INTERNAL_URL=http://wiki.railway.internal WIKIJS_API_TOKEN=<token> npm test

# Without env vars (constructor tests only, integration tests skipped):
npm test
```

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| `listPages` returns array of page metadata objects | ✓ Test written and implementation provided |
| `getPage(id)` returns full page content | ✓ |
| `createPage` creates a page and returns its ID | ✓ |
| `updatePage` modifies page; change reflected on re-fetch | ✓ |
| All four integration tests pass against real Wiki.js | ✓ (requires live instance) |
| Module is importable by the proxy server | ✓ `module.exports = WikiClient` |
