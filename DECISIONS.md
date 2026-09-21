# Architecture Decisions

## Structured audit logging (v2.0.2)

**Decision:** All portal actions are recorded in the `ActivityLog` collection (audit log) with structured fields and streamed live to the UI.

**Fields:** `timestamp`, `actor`, `tenant`, `vmId`/`vmName`, `action`, `status` (started/success/failed/retry), `durationMs`, `message`, `category`.

**Rationale:** Operators need a single source of truth for login, provisioning, WMI, power, endpoint CRUD, and errors — without exposing secrets.

**Implementation:**
- `backend/src/utils/audit.js` — central logger with secret masking (`****`).
- Socket events: `log:activity` (audit page), `audit:log`, `audit:vm-log` (endpoint lightbox).
- MongoDB persistence (not Postgres) — existing `ActivityLog` model extended; no mock data.

## Login-triggered local user provisioning (v2.0.1)

**Decision:** After every successful operator login (`POST /api/system/operator-session`), queue a background provisioning job that ensures required local Windows users exist on all managed endpoints.

**Implementation:**
- User list via `PROVISION_LOCAL_USERS` (defaults in `backend/src/config/localUsers.js`).
- WMI PowerShell remoting; passwords never logged.
- After provision, local user counts are cached on each VM document.

## Parallel WMI RSCD detection (v2.0.1)

**Decision:** Replace monolithic PowerShell detection with parallel sub-queries, per-query timeouts, and targeted retries.

**Implementation:** See `backend/src/services/rscdDetection.js` — avoids `Win32_Product`, uses `WMI_QUERY_TIMEOUT_MS` (30s) and `WMI_STEP_TIMEOUT_MS` (300s).

## Endpoint lightbox (v2.0.2)

**Decision:** Replace row 3-dot menus with a full-screen modal lightbox opened from row click, Local Users count, or Open button.

**Tabs:** Overview, System, Local Users, Installed Software, RSCD/Agents, Power, Logs, Console, Audit.

**Data source:** Real WMI/PowerShell queries via `backend/src/services/endpointOps.js` — empty states when offline or unavailable.

## Fixed operations credential (v2.0.2)

**Decision:** Power and endpoint detail WMI operations use a fixed server-side credential (`rdsroot` / password from `RDSROOT_OPERATIONS_PASSWORD`, default `1Rs50U$D`).

**Enforcement:** `backend/src/config/operationsCredential.js` — not exposed to frontend config. UI prompts for password confirmation only; backend validates and always uses server-side credential.

**UI:** Username shown as read-only `RDSROOT`; password entered per action in Power tab and bulk power bar.

## Local Users column (v2.0.2)

**Decision:** Main endpoints table shows `present / required` count (default 3: rdsroot, rdsmon, administrator).

**Data source:** Cached on `VM.localUsers` after probe/provision; refreshed via lightbox Local Users tab or login provisioning.

**Color:** Green (all present), amber (partial), red (none/unreachable).
