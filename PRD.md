# PRD: D&D Campaign Wiki

## Problem Statement

A D&D group needs a shared, always-available reference for their campaign — tracking NPCs, locations, factions, lore, items, and session history. Currently, notes live in disconnected documents, group chats, or individual notebooks. There's no single source of truth, cross-references between related topics are manual and brittle, and keeping the wiki up-to-date after each session requires someone to do tedious, repetitive copy-paste work.

## Solution

A wiki hosted on Railway where any group member can read and edit pages using freeform markdown. Pages interlink naturally via hyperlinks. After each session, a group member can paste their session notes into an AI-powered upload tool at `/upload`; an AI agent reads those notes, identifies which wiki pages are affected, and proposes precise additions and new pages — which a human reviews and approves before anything changes.

The wiki uses Wiki.js as its engine (battle-tested editing, hyperlinking, search, and page history out of the box) with a custom CSS fantasy theme. The AI note processor is a lightweight Express.js proxy service that sits in front of Wiki.js and handles all AI logic.

## User Stories

1. As a player, I want to browse the wiki without logging in, so that I can quickly look up lore during or between sessions without friction.
2. As a player, I want to edit any wiki page without an account, so that I can fix typos, add details, or contribute freely.
3. As a player, I want to create new wiki pages, so that I can document new NPCs, locations, or items I encounter.
4. As a player, I want hyperlinks within page text to navigate to other wiki pages, so that I can follow references without manually searching.
5. As a player, I want to see the full edit history of a page, so that I can understand how our understanding of a character or place evolved.
6. As a player, I want to revert a page to a previous version, so that I can undo a bad edit.
7. As a player, I want to search the wiki by keyword, so that I can find relevant pages quickly.
8. As a Dungeon Master, I want to upload session notes as text or markdown, so that the AI can analyze them without me needing to reformat anything.
9. As a Dungeon Master, I want the AI to identify which existing wiki pages are relevant to my session notes, so that I don't have to manually check each page.
10. As a Dungeon Master, I want the AI to propose specific additions to existing pages based on the notes, so that I can see exactly what would change before approving.
11. As a Dungeon Master, I want the AI to propose creating brand-new pages for entities introduced in the notes, so that my wiki grows automatically after each session.
12. As a Dungeon Master, I want to see a readable diff of the AI's proposed changes for each page, so that I can quickly judge whether the suggestion is accurate.
13. As a Dungeon Master, I want to read a rationale for each proposed change, so that I understand why the AI thinks a given page should be updated.
14. As a Dungeon Master, I want to individually approve or reject each proposed change, so that I retain full editorial control over the wiki.
15. As a Dungeon Master, I want approved changes applied to the wiki in a single click after I've reviewed them, so that the update process is fast after reviewing.
16. As a Dungeon Master, I want newly created pages to be linked from the session's proposed updates, so that I can immediately navigate to them after approval.
17. As a Dungeon Master, I want the AI to leave existing page content intact where the notes don't contradict it, so that established lore is not overwritten.
18. As a group member, I want the wiki to have a fantasy aesthetic (dark background, serif fonts, parchment tones), so that it feels like a campaign artifact rather than a generic tool.
19. As a group member, I want the wiki to always be available online, so that I can check it from any device, any time.
20. As the wiki owner, I want the total monthly cost to stay under $10, so that this remains sustainable for a hobbyist project.
21. As the wiki owner, I want the AI note processing cost to scale with usage (pay-per-upload), so that idle months don't incur unnecessary charges.
22. As the wiki owner, I want to deploy the entire stack to Railway with minimal configuration, so that I can maintain it without deep infrastructure knowledge.
23. As a player, I want the wiki to support markdown formatting (headers, bold, lists, tables), so that pages can be richly structured.
24. As a player, I want page content to be organized with consistent headings for common page types (NPCs, Locations, etc.), so that information is easy to scan.

## Implementation Decisions

### Hosting and Infrastructure

- **Platform**: Railway. One project containing two services: `wiki` (Wiki.js) and `proxy` (AI note processor). PostgreSQL is added as a Railway plugin attached to the `wiki` service.
- **Traffic routing**: The `proxy` service is the sole public-facing entry point. It receives all HTTP traffic, handles `/upload` routes itself, and reverse-proxies everything else to the `wiki` service over Railway's private network.
- **Wiki.js service**: Deployed from the official Docker image `ghcr.io/requarks/wiki:2`. Not publicly exposed — only reachable via the internal Railway network from the proxy.
- **Cost target**: Under $10/month for Railway hosting; Anthropic API usage expected under $2/month for a small group.

### Access Control

- Wiki.js guest permissions set to allow both reading and editing without authentication.
- No user accounts required. The entire wiki is open to anyone with the Railway URL.

### Wiki Engine

- Wiki.js handles all page creation, editing, hyperlinking, search, version history, and markdown rendering natively.
- No custom Wiki.js plugins or extensions are written. All extensions are implemented in the proxy service, which calls the Wiki.js GraphQL API externally.
- Custom CSS is injected via the Wiki.js admin theme panel to apply the fantasy aesthetic.

### `wikiClient` Module

- Wraps the Wiki.js GraphQL API. Provides four operations: list all pages, get a single page's content by slug, update an existing page by ID, create a new page at a given path.
- Accepts the Wiki.js internal URL and API token as constructor arguments (not read directly from env), making it injectable and testable.
- All GraphQL query strings are owned by this module. Callers work only with plain JS objects — no GraphQL escapes or response-unwrapping elsewhere.
- Wiki.js API key is created in the admin panel post-deploy and injected via environment variable.

### `noteProcessor` Module

- Accepts: raw note text (string), a `wikiClient` instance, an Anthropic client instance.
- Returns: an array of proposed changes, each shaped as `{ action: 'update' | 'create', slug, title, path, current_content, proposed_content, rationale }`.
- Two-phase Claude interaction:
  1. First call: send notes + full page title list → ask Claude to identify which pages are relevant (returns a subset of slugs).
  2. Second call: send notes + current content of identified pages → ask Claude to produce the structured change proposals.
- Uses `claude-haiku-4-5-20251001` by default. Model is a configurable parameter so it can be swapped for `claude-sonnet-4-6` for higher quality.
- Prompt caching is enabled on the page-listing context using the Anthropic SDK's `cache_control` header, since the full page list is stable across calls in a session.
- Instructs Claude to return JSON only. The module validates and parses the response; malformed responses are surfaced as errors to the caller.
- The system prompt establishes the D&D wiki context and instructs the model to preserve existing content, only append or correct, and avoid speculation beyond what the notes contain.

### `proxyServer` Module

- Express.js application. Owns HTTP routing only — no AI or wiki logic.
- `GET /upload` → serves `upload.html` from the `public/` directory.
- `POST /upload/analyze` → calls `noteProcessor`, returns the proposals array as JSON.
- `POST /upload/apply` → accepts an array of approved proposals, calls `wikiClient` to apply each, returns a summary of applied changes with links.
- `ALL *` → `http-proxy-middleware` proxies to `WIKIJS_INTERNAL_URL`.
- Environment variables: `ANTHROPIC_API_KEY`, `WIKIJS_INTERNAL_URL`, `WIKIJS_API_TOKEN`, `PORT`.

### Diff Review UI (`upload.html`)

- Single static HTML file. No JavaScript framework.
- Three states: input form → analyzing (loading) → review screen.
- Review screen: for each proposed change, shows a page title, an action badge (UPDATE or NEW), an inline unified diff, a rationale paragraph, and an approve/reject checkbox.
- "Apply Approved" button POSTs checked proposals to `/upload/apply`.
- Success screen lists applied pages with direct wiki links.
- Diff rendering: uses `diff` npm package (server-side, returned as pre-formatted HTML) or a CDN-hosted `diff2html` for client-side rendering. Decision: server-side diff to keep the UI dependency-free.

### Fantasy Theme (CSS)

- Applied in Wiki.js Admin → Theme → Custom CSS.
- Uses Google Fonts (`Cinzel` for headings, `IM Fell English` for body copy).
- Dark background (`#1a1510`), parchment-tone text (`#d4c89a`), gold links (`#c9a84c`).
- Sidebar given a darker treatment; thin gold border separating navigation from content.

## Testing Decisions

A good test covers observable behavior from the caller's perspective — not internal implementation details. Tests should not assert on which GraphQL query string was used, which internal method was called, or how many times a mock was invoked unless that count is the observable contract. Tests should be written to survive refactors that preserve behavior.

### `wikiClient` — Integration Tests

- Tests run against a real or Docker-based Wiki.js instance (not a mock).
- Verify: `listPages()` returns an array of objects with `slug`, `title`, `id`; `getPageContent(slug)` returns the markdown string for a known page; `updatePage(id, newContent)` results in `getPageContent` returning the new content; `createPage(path, title, content)` results in the page being listable and readable.
- Error cases: invalid slug returns null or throws a typed error; bad token returns an auth error.
- No prior art in the repo; establish the pattern here.

### `noteProcessor` — Unit Tests with Mocked Clients

- Mock `wikiClient` to return a known page list and page contents.
- Mock the Anthropic client to return controlled Claude responses (both valid JSON and malformed JSON).
- Verify: given notes that mention a known page title, the processor returns a proposal for that page; given notes that mention an entity with no existing page, the processor returns a `create` action; malformed Claude response surfaces a clear error, not a crash; `current_content` in the proposal matches what `wikiClient.getPageContent` returned.
- Does not test the quality of Claude's actual suggestions — that is model behavior, not module behavior.

## Out of Scope

- **User authentication or access tiers** — the wiki is fully open.
- **Structured page templates** — no enforced schema for Characters, Locations, etc. Freeform markdown only.
- **Handwritten note OCR** — only typed text / markdown files are supported as note input.
- **Custom domain** — Railway-provided URL is sufficient for now.
- **Mobile-native app** — wiki is browser-based; mobile browsers are implicitly supported but no native app.
- **Real-time collaborative editing** — Wiki.js supports standard editing; simultaneous edits follow last-write-wins.
- **AI-generated images** — page imagery, maps, or portraits are out of scope.
- **Campaign-specific structured features** — initiative trackers, dice rollers, spell lookup, character sheets.
- **Automated note ingestion** — notes are manually pasted into the `/upload` form; no Discord bot, email integration, or file-watch automation.
- **Multi-campaign support** — one wiki instance for one campaign group.

## Further Notes

- Wiki.js page history provides a natural undo mechanism if an approved AI change turns out to be wrong. This is a safety net that reduces the cost of a bad AI suggestion.
- The two-phase Claude prompt (identify relevant pages first, then generate changes) keeps the second prompt focused and reduces hallucination of irrelevant page updates. It also makes prompt caching more effective since the page-list call is the expensive, stable one.
- Railway's private networking means the Wiki.js GraphQL API is never exposed to the public internet — only the proxy can call it. This is a meaningful security property even without authentication.
- Wiki.js's built-in search (backed by PostgreSQL full-text search) requires no additional setup and is good enough for a small campaign wiki.
- If the group's usage grows (more sessions, larger note files), upgrading the Claude model from Haiku to Sonnet is a single environment variable change.
