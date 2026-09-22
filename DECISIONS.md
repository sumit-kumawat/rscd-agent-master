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

## Local Users column (v2.0.2, removed from table v2.0.4)

**Decision:** Local Users removed from the main endpoints table. Data remains in `VM.localUsers` and is visible in the endpoint lightbox **Local Users** tab.

## Full endpoint sync + split refresh (v2.0.4)

**Decision:** Separate **synced** (hourly / on-load / manual) from **live** (auto-refresh) data paths.

- `endpointSync.runFullSync()` — WMI probe + overview/local-users/power per host; writes `VM.lastFullSyncAt`.
- Hourly background job via `endpointSync.startHourlySync()`.
- Dashboard synced widgets (`/api/dashboard/synced`) refresh on sync complete only.
- Dashboard live widgets (`/api/dashboard/live`) refresh on `RefreshContext` tick + sockets.
- Portal skeleton until first `sync:complete` on load.

## Open portal access (v2.0.4)

**Decision:** Remove portal-operator role, `OPERATOR_API_KEY` gates, and operator-only middleware. All features available after platform login.

- `POST /api/system/login` replaces operator-session bootstrap.
- Audit actor defaults to `user`.

## Apple-style UI (v2.0.4)

**Decision:** Adopt Apple-inspired design tokens in `frontend/src/index.css` and shared components under `frontend/src/components/ui/` (no separate `packages/ui` monorepo).

- Lucide icons, stroke 1.5, sizes 16/20/24.
- Compact spacing: 16px card padding/gaps, 16/24px page padding.
- Soft neutrals, `#0A84FF` accent, 12px card radius.

## Endpoints table simplification (v2.0.4)

**Decision:** Table columns: Hostname, IP, OS, Health, Power. Row click opens lightbox. No Actions, Last Seen, or Local Users columns.

## Never block portal on sync (v2.0.8)

**Root cause:** `SyncContext` showed a full-page skeleton until `sync:complete`, and `POST /api/sync/full` awaited the entire fleet sync (hours for large inventories).

**Fix:** Portal renders immediately; sync runs in background (`setImmediate` on backend). Non-blocking sync banner only. Status polled every 12s as Socket.IO fallback.

## useApiQuery fetch contract (v2.0.8)

**Decision:** Every tab and list uses `useApiQuery` — 15s timeout, 2 retries, cached `initialData` from MongoDB inventory, skeleton placeholders (not text spinners), inline error + Retry.

**Rule:** UI must never stay on "Loading…" forever.

## Bulk RSCD uninstall (v2.0.8)

**Decision:** Bulk and single uninstall via `POST /api/endpoints/bulk-uninstall-rscd`. Uses fixed Administrator credential (`Helix@dm1n`), not VM-stored WMI creds or UI input.

**UI:** Bulk action bar on Endpoints (multi-select) + lightbox RSCD tab. Confirmation dialog lists affected hosts.

**Concurrency:** `RSCD_UNINSTALL_CONCURRENCY` (default 5). Per-endpoint phases streamed via `job:vm-phase`.

## Anti-flicker rendering (v2.0.9)

**Root causes fixed:**
- Dashboard/Jobs/Logs set `loading=true` on every 30s tick → replaced with silent refetch via `useApiQuery`.
- `vm:status` socket triggered full VM list reload → `patchData()` merges single-row updates.
- Unstable `useApiQuery` deps (`initialData` object per render) → removed; lightbox uses `useMemo` + `mergeTabData`.
- Sync banner layout shift → animated `sync-banner-slot` height transition.
- Lightbox/modals inside page DOM → `Portal` to `document.body`.

**Deleted:** `PortalSkeleton.jsx` (full-page sync gate — no longer used).

## Deployment platform on MongoDB (v2.0.10)

**Decision:** Extend the existing Express + MongoDB stack instead of introducing Prisma/PostgreSQL mid-flight. Job, Package, and SyncRun Mongoose models mirror the deployment schema requirements; existing RSCD uninstall (`winRemote` + `uninstall.js`) remains the authoritative RSCD pipeline.

**Remote credentials:** Per-endpoint WMI credentials when present; otherwise server-enforced `Administrator` / `Helix@dm1n` via `remoteCredential.js` (never exposed to UI/API).

**Scale:** Worker pool (`runPool`) with `DEPLOY_CONCURRENCY`, separate `RND_*` / `PROD_*` limits, and per-endpoint isolation — no unbounded parallel WMI sessions.

**Software detection:** Centralized registry enumeration in `registrySoftware.js` (no `Win32_Product`). Sync persists snapshots + RSCD/CrowdStrike summary on each endpoint.

**Environments:** `rnd` vs `prod` on endpoints and jobs; PROD requires `confirmedProd` on deployment APIs; header environment selector filters endpoint list.
