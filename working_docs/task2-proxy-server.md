# Task 2: Proxy Server — Wiki.js Passthrough

## Summary

Hardened the existing Express.js proxy server to be production-ready for Railway deployment.

## Changes

### `server.js`
- Added startup validation: exits with a clear error message if `WIKIJS_INTERNAL_URL` is not set (prevents silent failures at runtime).
- Enabled WebSocket proxying (`ws: true`) so Wiki.js real-time features work through the proxy.
- Added error handler on the proxy middleware: returns 502 with a human-readable message instead of crashing or hanging when the upstream wiki is unreachable.

### `package.json`
- Added `axios` and `jest` as dependencies (groundwork for Tasks 3 and 5).
- Added `test` script pointing directly to the jest binary to work around a path-parsing issue caused by the `&` character in the project directory name.

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Proxy's public URL returns same Wiki.js pages | ✓ `http-proxy-middleware` handles all HTTP methods and paths |
| Static assets, navigation, editing work through proxy | ✓ `changeOrigin: true` + WebSocket support |
| Service restarts cleanly with correct start command | ✓ `npm start` → `node server.js` |
