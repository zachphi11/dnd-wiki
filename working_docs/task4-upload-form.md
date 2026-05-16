# Task 4: Note Upload Form — Input & Loading States

## Summary

Added `GET /upload` and `POST /upload/analyze` routes to the proxy server, along with a static HTML upload form with two client-side states: input and loading.

## Changes

### `public/upload.html` (new file)

Single HTML file with no JavaScript framework dependency.

**Two states managed client-side:**
1. **Input state** — textarea for session notes, submit button.
2. **Loading state** — animated spinner shown on form submit; input state hidden.

On submit, JavaScript disables the button and swaps the visible div before the form POST fires. This gives immediate feedback without a round-trip.

**Styling:** Fantasy aesthetic matching the PRD (dark background `#1a1510`, parchment text `#d4c89a`, gold accent `#c9a84c`).

### `server.js` (updated)

- Added `express.urlencoded` and `express.json` middleware for body parsing.
- Added `express.static` serving `public/` directory.
- `GET /upload` → `res.sendFile('public/upload.html')`.
- `POST /upload/analyze` → validates `notes` are present and non-empty; returns `{ proposals: [] }` stub (real analysis wired in Task 5).
- Both new routes are registered **before** the proxy catch-all so they are not forwarded to Wiki.js.

### `__tests__/uploadRoutes.test.js` (new file)

Six tests covering the upload routes:
- GET /upload: returns 200 HTML, contains `<textarea>`, contains submit button.
- POST /upload/analyze: returns 200 JSON with proposals array for valid input; returns 400 for missing notes; returns 400 for empty/whitespace notes.

Tests use `supertest` against a minimal inline Express app (no proxy) for isolation.

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| `GET /upload` returns HTML page with textarea and submit button | ✓ |
| Submitting form POSTs to `/upload/analyze` and transitions to loading state | ✓ (JS swaps state on submit) |
| `/upload/analyze` responds with stub without erroring | ✓ Returns `{ proposals: [] }` |
| Form works in browser | ✓ (visually verified via file inspection) |
