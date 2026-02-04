# Server.js Refactor Plan

## Current State: 1834 lines, single file

## Proposed Module Breakdown

### 1. `src/server.js` (Entry Point) — ~80 lines
**Responsibility:** App setup, middleware, mount routes, start server
- Express + HTTP + WebSocket setup
- Static file serving
- Mount all route modules
- WebSocket connection handling
- File watcher setup
- `server.listen()`

### 2. `src/routes/sessions.js` — ~80 lines
**Endpoints:**
- `GET /api/sessions` (line 287) — List all sessions
- `GET /api/sessions/:id` (line 311) — Get single session activity

**Dependencies:** parser.js, risk-analyzer.js

### 3. `src/routes/activity.js` — ~150 lines
**Endpoints:**
- `GET /api/activity` (line 345) — List activities with filters
- `GET /api/stats` (line 419) — Aggregate statistics
- `GET /api/meta` (line 494) — Metadata
- `GET /api/sequences` (line 580) — Suspicious sequences detection

**Dependencies:** parser.js, risk-analyzer.js
**Note:** Includes helper functions for sequence detection (lines 580-1007)

### 4. `src/routes/gateway.js` — ~120 lines
**Endpoints:**
- `GET /api/gateway/status` (line 1184) — Gateway process status
- `POST /api/gateway/kill` (line 1220) — Kill switch
- `POST /api/gateway/restart` (line 1272) — Restart gateway

**Dependencies:** Gateway helper functions (findGatewayProcess, killGatewayProcesses, detectGatewayCli)

### 5. `src/routes/alerts.js` — ~100 lines
**Endpoints:**
- `GET /api/alerts/config` (line 1305) — Get alert config
- `POST /api/alerts/config` (line 1312) — Update alert config
- `POST /api/alerts/test` (line 1344) — Test alert

**Dependencies:** alertConfig state

### 6. `src/routes/streaming.js` — ~120 lines
**Endpoints:**
- `GET /api/streaming` (line 1383) — Get streaming config
- `POST /api/streaming` (line 1401) — Update streaming config
- `POST /api/streaming/test` (line 1437) — Test streaming endpoint
- `POST /api/streaming/flush` (line 1482) — Flush stream buffer

**Dependencies:** streamingConfig state, flushStreamBuffer, streamBuffer

### 7. `src/routes/exports.js` — ~80 lines
**Endpoints:**
- `GET /api/export/json` (line 1115) — JSON export
- `GET /api/export/csv` (line 1139) — CSV export

**Dependencies:** parser.js, risk-analyzer.js

### 8. `src/routes/dump.js` — ~150 lines
**Endpoints:**
- `POST /api/dump/session/:id` (line 1504) — Dump single session
- `POST /api/dump/all` (line 1574) — Dump all sessions
- `GET /api/dump/preview` (line 1655) — Preview dump

**Dependencies:** parser.js, risk-analyzer.js

### 9. `src/routes/config.js` — ~60 lines
**Endpoints:**
- `GET /api/config` (line 508) — Get app config
- `POST /api/config` (line 530) — Update app config

**Dependencies:** config.js, alertConfig/streamingConfig state

### 10. `src/routes/version.js` — ~50 lines
**Endpoints:**
- `GET /api/version` (line 1816) — Version + update check

**Dependencies:** package.json

### 11. `src/lib/gateway.js` (New) — ~70 lines
**Extracted from server.js lines 33-88:**
- `GATEWAY_NAMES` constant
- `PS_GREP_PATTERN` constant
- `findGatewayProcess()`
- `killGatewayProcesses()`
- `detectGatewayCli()`

### 12. `src/lib/streaming.js` (New) — ~120 lines
**Extracted from server.js lines 108-275:**
- `streamingConfig` state
- `streamBuffer`, `streamingStats`, `lastProcessedLines`
- `flushStreamBuffer()`
- `processNewLogEntries()`
- `startStreamingInterval()`

### 13. `src/lib/alerts.js` (New) — ~80 lines
**Extracted from server.js lines 94-105, 1687-1740:**
- `alertConfig` state
- `sendAlert()` function

### 14. `src/lib/sequence-helpers.js` (New) — ~500 lines
**Extracted from server.js lines ~580-1007:**
- All the helper functions used by sequence detection
- `isSensitivePath()`, `isNetworkCommand()`, `isSudoCommand()`, etc.
- `getSummary()`

## Shared State

These need to be accessible across modules:
- `alertConfig` — used by alerts routes, config routes, streaming processor
- `streamingConfig` — used by streaming routes, config routes, log processor
- `clients` (WebSocket set) — used by kill switch broadcast, file watcher
- `SESSIONS_DIR` — used by most route modules

**Approach:** Create `src/lib/state.js` that exports shared mutable state objects.

## Migration Steps

1. Create all new files with code copied from server.js
2. Create `src/lib/state.js` for shared state
3. Create new `src/server-new.js` that mounts everything
4. Write comprehensive tests for all modules
5. Verify all tests pass
6. Swap server-new.js → server.js
7. Archive old file (retain as server-old.js for reference)
