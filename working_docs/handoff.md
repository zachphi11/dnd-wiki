# Handoff — D&D Wiki Proxy

## What this project is

A Railway-hosted Express.js proxy that sits in front of a private Wiki.js instance. It adds an AI-powered session-note upload tool at `/upload` that uses Claude Haiku to propose wiki page updates, which the DM reviews and approves before anything changes.

Full product context: [working_docs/PRD.md](working_docs/PRD.md)

---

## Current state

**All 6 tasks in [working_docs/todo.md](working_docs/todo.md) are complete.** The code is committed but not yet pushed to a GitHub remote or deployed to Railway.

### Git log
```
b8868ed Task 6: complete upload flow with diff review UI and apply route
bfa9a7a Task 5: add noteProcessor with two-phase Claude analysis and unit tests
fe24e57 Task 4: add upload form with input and loading states
ae38734 Task 3: add wikiClient module and integration tests
a50b77e Task 2: harden proxy server for Railway production
6b60ca9 Initial proxy server
```

### Key files
| File | Purpose |
|---|---|
| `server.js` | Express app — upload routes + proxy catch-all |
| `wikiClient.js` | Wiki.js GraphQL API wrapper (listPages, getPage, createPage, updatePage) |
| `noteProcessor.js` | Two-phase Claude Haiku analysis of session notes |
| `public/upload.html` | Single-page upload UI (input → loading → review → success states) |
| `__tests__/` | Jest test suite (21 passing, 5 integration-skipped) |

### Task logs
Each task has a corresponding doc: `working_docs/task{2-6}-*.md`

---

## What the user needs to do next (deployment)

The user is new to Railway and has not deployed yet. The conversation ended with them understanding:
- The Express app runs on Railway (not their laptop)
- Deployment = `git push` once the repo is connected to Railway
- Railway auto-redeploys on every push

### Deployment steps still to complete

1. **Create a GitHub repo** and push:
   ```bash
   git remote add origin https://github.com/YOU/dnd-wiki-proxy.git
   git push -u origin main
   ```

2. **On Railway** (railway.app):
   - New Project
   - Add **Wiki.js** service: Docker image `ghcr.io/requarks/wiki:2`
   - Add **PostgreSQL** plugin attached to Wiki.js
   - Set Wiki.js env vars: `DB_TYPE=postgres` + the DB_* vars Railway provides from the plugin
   - **Do not expose Wiki.js publicly**
   - Add **proxy** service from the GitHub repo
   - Railway will run `npm start` automatically

3. **Complete Wiki.js setup wizard** (requires temporarily exposing it):
   - Finish the setup wizard
   - Go to Admin → API Access → create an API key
   - Re-hide Wiki.js's public URL

4. **Set proxy env vars** in Railway:
   - `WIKIJS_INTERNAL_URL` = the internal hostname Railway assigns to Wiki.js
   - `WIKIJS_API_TOKEN` = the API key from step 3
   - `ANTHROPIC_API_KEY` = user's Anthropic key

5. **Verify**: visit the proxy's public Railway URL — wiki loads; `/upload` shows the upload form.

---

## Environment variables

See [.env.example](.env.example) for the full list. The actual `.env` is gitignored.

For local testing: fill in `.env` and run `npm start`. Note that `WIKIJS_INTERNAL_URL` (Railway's private hostname) is only reachable from inside Railway's network — local testing of the full flow requires a local Wiki.js instance (Docker) or testing directly on Railway.

---

## Test suite

```bash
npm test                          # unit tests only (no env vars needed)

# With env vars set, also runs wikiClient integration tests:
# WIKIJS_INTERNAL_URL=... WIKIJS_API_TOKEN=... npm test
```

---

## Suggested next session focus

- Walk the user through Railway deployment (steps above)
- Verify the full end-to-end flow works: browse wiki → upload notes → review → apply
- Potentially: add the Wiki.js fantasy CSS theme (described in PRD but not yet implemented)
