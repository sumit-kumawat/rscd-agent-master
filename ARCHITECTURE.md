# RSCD Agent Master — Architecture

**Version:** see `version.txt` (current: 2.0.15)

## Overview

RSCD Agent Master is a Windows-only control portal for monitoring, auditing, and uninstalling BMC BladeLogic RSCD agents. Connectivity uses WMI (Impacket `wmiexec` or macOS host relay). React SPA + Node.js/Express + MongoDB + Socket.IO.

## Navigation shell (v2.0.15)

- React Router 7 with `Layout` + keyed `<Outlet key={location.pathname} />` so client-side navigation always mounts the target page (no hard refresh).
- Sidebar uses explicit `useLocation()` active matching; logo-only brand in sidebar; minimal header (search, filter, sync, auto-refresh 15–120s, Refresh).

## Assets page (v2.0.15)

Table columns only: **Hostname, IP, Operating System, RSCD (Active/Inactive), CrowdStrike (Active/Inactive), Power (up/down dot)**. Row click opens endpoint lightbox (all tabs). Data from `GET /api/vms` without environment filter; live patches via `vm:status` and `vms:imported` sockets. Bulk selection uses a hidden checkbox column for jobs/deploy/power.

## Dashboard layout (v2.0.15)

Fixed viewport (no outer scroll): combined **Total / Online / Offline** card, **Connectivity Trends**, **Fleet Status** on top row; **Needs Attention**, **Job Activities**, **Fleet Progress** on second row. Internal card bodies scroll only.

## Audit log UI (v2.0.15)

Spreadsheet table: sortable columns, sticky header/first column, row click copies TSV, CSV export.

## Data sync model (v2.0.4+)

```
Portal load / Sync now / 3-hour job
  → endpointSync.runFullSync()
    → connectivity.checkAndUpdate (full WMI probe per host)
    → endpointOps fetch (overview, local users, power) when online
    → VM.lastFullSyncAt + cached fields in MongoDB
    → audit log per endpoint + sync.full summary
    → Socket.IO: sync:start, sync:progress, sync:complete

Live monitor (30s default)
  → monitor.run() → lightweight probes → vm:status sockets
```

| Cadence | What updates | UI refresh |
|---------|--------------|------------|
| On load + manual **Sync now** + every **3 hours** (`SYNC_INTERVAL_HOURS`) | Full WMI inventory, local users, hardware fields, synced dashboard widgets | `SyncContext.syncedTick` |
| Auto-refresh interval (15–120s, default 15s) | Health, power, running jobs, attention list, job bars, assets table | `RefreshContext.tick` |
| Socket events | `vm:status`, `job:*`, `log:activity` | Live widgets only |

**API:**
- `POST /api/sync/full` — trigger immediate full re-sync
- `GET /api/sync/status` — running state, last sync time
- `GET /api/dashboard/synced` — DB-synced widgets (stats, trend, donut, progress)
- `GET /api/dashboard/live` — agent-driven widgets (online now, attention list, job bars)

Portal renders immediately on load; background sync shows a non-blocking banner. Sync never blocks page render.

## Authentication (v2.0.4)

The portal is open to all logged-in users. There is **no portal-operator role** or permission gate beyond platform login.

- `POST /api/system/login` — session bootstrap + provisioning queue
- Default audit actor: `user` (override via `X-Actor` header)
- `OPERATOR_API_KEY` / operator middleware are deprecated no-ops

## Audit logging

```
Action → audit.log() → ActivityLog (MongoDB)
                    → Socket.IO: log:activity, audit:vm-log
```

Sync events use `category: sync` with actions `sync.full` and `sync.endpoint`.

## Endpoint lightbox

Opened by **row click** on the endpoints table (no Actions column).

| Tab | API | Data source |
|-----|-----|-------------|
| Overview | `GET /api/vms/:id/detail/overview` | WMI live query |
| System | `.../system` | WMI |
| Local Users | `.../local-users` | WMI Get-LocalUser |
| Software | `.../software` | WMI registry |
| RSCD/Agents | `.../rscd` | `rscdDetection` |
| Power | `.../power` + `POST .../power` | WMI |
| Logs / Audit | `.../logs`, `.../audit` | ActivityLog |
| Console | `.../console` | RDP URL |

## Endpoints table columns (v2.0.4)

Hostname · IP · OS · Health · Power State

Local Users and Last Seen are available in the lightbox only.

## Dashboard

**Route:** `/dashboard` (registered in React Router; sidebar link fixed in v2.0.4)

**Widgets:** Stat cards (synced total + live online), trend/donut/progress from sync, list + job bars live.

## Apple-style design tokens (v2.0.4)

Defined in `frontend/src/index.css` and shared UI components (`frontend/src/components/ui/`):

| Token | Value |
|-------|-------|
| Background | `#F5F5F7` |
| Cards | `#FFFFFF`, 12px radius |
| Text | `#1D1D1F` / muted `#6E6E73` |
| Accent | `#0A84FF` |
| Shadows | soft `0 1px 2px`, `0 4px 12px` |
| Icons | Lucide, stroke 1.5, sizes 16/20/24 |
| Spacing | 16px mobile / 24px desktop page padding, 16px card padding & gaps |

## Layout & scrolling

- Sidebar + header: sticky, fixed height
- Main content: independent vertical scroll (`overflow-y: auto`)
- Tables: scroll inside `.table-wrap` card
- Lightbox: internal scroll, `body.modal-open` locks outer page

## Key modules

| Path | Role |
|------|------|
| `backend/src/services/endpointSync.js` | Full sync + hourly scheduler |
| `backend/src/services/dashboard.js` | Synced vs live widget aggregation |
| `backend/src/api/routes/sync.js` | Sync API |
| `frontend/src/context/SyncContext.jsx` | Initial sync skeleton + Sync now |
| `frontend/src/context/RefreshContext.jsx` | Live auto-refresh tick |
| `frontend/src/components/ui/*` | Shared Apple-style UI primitives |

## Bulk RSCD uninstall (v2.0.8)

`POST /api/endpoints/bulk-uninstall-rscd` with `{ endpointIds: string[] }` (alias: `POST /api/vms/bulk-uninstall-rscd`).

- Fixed credential: **Administrator / Helix@dm1n** (`RSCD_UNINSTALL_USER`, `RSCD_UNINSTALL_PASSWORD`) — not configurable from UI.
- Per-host sequence: detect → stop → disable → MSI uninstall → registry → directories → verify.
- Parallel across endpoints (`RSCD_UNINSTALL_CONCURRENCY`, default 5); sequential steps per host.
- Live progress: `job:progress`, `job:vm-step`, `job:vm-phase`, `log:new`.
- Idempotent: absent agent → `not_present`, not an error.

| Variable | Default |
|----------|---------|
| `RSCD_UNINSTALL_CONCURRENCY` | 5 |
| `RSCD_UNINSTALL_TIMEOUT_MS` | 600000 |
| `RSCD_STEP_TIMEOUT_MS` | 120000 |

## Fetch contract (v2.0.9)

All UI data loads use `frontend/src/hooks/useApiQuery.js`:

- 15s timeout, 2 retries with exponential backoff, AbortController on unmount.
- Always resolves: **data**, **empty**, or **error** — never infinite loading.
- First fetch shows skeleton; refetches are **silent** (no loading flash).
- `patchData()` for in-place socket updates without full table reload.
- Modals/lightboxes render via `Portal` (body) with scroll lock.

## Deployment & packages (v2.0.10)

| API | Purpose |
|-----|---------|
| `POST /api/deployments/install` | MSI/EXE install job (package transfer + SHA-256 verify + silent install) |
| `POST /api/deployments/uninstall` | Product uninstall (RSCD pipeline, CrowdStrike/custom registry uninstall) |
| `GET /api/deployments/:id` | Job + per-endpoint results |
| `POST /api/deployments/:id/cancel` | Cancel queued work |
| `POST /api/deployments/:id/retry-failed` | Retry failed endpoints |
| `POST /api/packages/upload` | Store package (max `DEPLOY_MAX_PACKAGE_MB`) |
| `POST /api/endpoints/programs` | Parallel installed-software query for product picker |

Models: `Package`, `SyncRun`, extended `Job` (`endpointResults`, `environment`, `type`), extended `VM` (`softwareSnapshot`, RSCD/CrowdStrike fields).

UI: header **R&D / PROD** selector, **Deploy wizard** on Endpoints (multi-step install/uninstall), job page **endpoint progress** grid.

## Health & observability (v2.0.8)

- `GET /health` — version, MongoDB state, WMI config, uptime.
- `GET /ready` — DB ping + sync status (503 if DB down).
- Boot log line with version and boot time.
- Frontend: `SocketContext` (connection badge), `ErrorBoundary`, `/debug` (dev-only).

## WMI timeouts

| Variable | Default |
|----------|---------|
| `WMI_CONNECT_TIMEOUT_MS` | 45000 |
| `WMI_QUERY_TIMEOUT_MS` | 30000 |
| `WMI_STEP_TIMEOUT_MS` | 300000 |
| `ENDPOINT_SYNC_INTERVAL_HOURS` | 1 |
