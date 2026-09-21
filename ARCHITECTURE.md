# RSCD Agent Master — Architecture

**Version:** see `version.txt` (current: 2.0.3)

## Overview

RSCD Agent Master is a Windows-only control portal for monitoring, auditing, and uninstalling BMC BladeLogic RSCD agents. Connectivity uses WMI (Impacket `wmiexec` or macOS host relay). React SPA + Node.js/Express + MongoDB + Socket.IO.

## Audit logging model (v2.0.2)

```
Action → audit.log() → ActivityLog (MongoDB)
                    → Socket.IO: log:activity, audit:log, audit:vm-log
```

| Field | Description |
|-------|-------------|
| actor | Operator identity (`portal-operator` or `X-Actor` header) |
| tenant | `TENANT_ID` env (default `default`) |
| action | e.g. `login.success`, `power.off_force`, `wmi.detect`, `vm.create` |
| status | `started`, `success`, `failed`, `retry` |
| durationMs | Wall-clock duration |
| vmId/vmName | Endpoint scope when applicable |

Secrets are masked as `****` before persistence.

**UI surfaces:**
- **Audit Log** page (`/logs`) — all events, filterable by category
- **Job log** — uninstall/provision jobs (`log:new`)
- **Endpoint lightbox** Logs/Audit tabs — per-VM stream via `audit:vm-log`

## Endpoint lightbox

Opened from endpoints table row, Local Users cell, or Open button.

| Tab | API | Data source |
|-----|-----|-------------|
| Overview | `GET /api/vms/:id/detail/overview` | WMI: hostname, OS, model, service tag |
| System | `.../system` | WMI: CPU, RAM, disks, NICs |
| Local Users | `.../local-users` | WMI: Get-LocalUser for required accounts |
| Software | `.../software` | WMI: registry uninstall keys |
| RSCD/Agents | `.../rscd` | `rscdDetection.detectRscd()` |
| Power | `.../power` + `POST .../power` | WMI shutdown commands |
| Logs / Audit | `.../logs`, `.../audit` | ActivityLog filtered by vmId |
| Console | `.../console` | RDP launch URL (real, not mock) |

Loading skeleton per tab; empty states when endpoint offline.

## Dashboard (v2.0.3)

**Route:** `/dashboard` (default landing)

**API:** `GET /api/dashboard?status=online|offline` — aggregates VMs, jobs, and `ActivityLog` into widget payloads (stats, trend, donut, attention list, progress bars, job bar chart). No mock data.

**Layout:** Sticky collapsible sidebar · header with global search, endpoint filter, view toggle, auto-refresh interval, manual refresh, operator avatar · responsive card grid on `#F3F4F6` background.

**Reusable widgets** (`frontend/src/components/ui/`): `StatCard`, `TrendChartCard`, `DonutCard`, `ListCard`, `MiniProgressCard`, `MiniBarChartCard`, `DashboardHeader`, `Sidebar`, `CardShell`.

**Refresh:** `RefreshContext` drives 15–120s auto-refresh (`tick`) consumed by dashboard and list pages; header controls replace the legacy toolbar refresh on the home view.

**Charts:** Recharts with primary `#2F3EA0`; tooltips show live API values; per-card empty states when inventory is empty.

## Endpoints table columns

Hostname · IP · OS · Health · Power State · Local Users · Last Seen · Actions

**Local Users:** `VM.localUsers.present / required` with green/amber/red coding. Tooltip lists present vs missing users.

**Power State:** `on` / `off` / `unknown` — updated on WMI probe (`connectivity.checkAndUpdate`).

## Fixed operations credential

Server-side only (`backend/src/config/operationsCredential.js`):

- Username: `rdsroot` (displayed as RDSROOT)
- Password: `RDSROOT_OPERATIONS_PASSWORD` env (default `1Rs50U$D`)

Used for power operations and endpoint detail WMI. UI cannot override; password prompt is confirmation-only.

## Core flows

### Login & provisioning
`POST /api/system/operator-session` → audit log → background provision job → updates `VM.localUsers`

### Uninstall
`winRemote.runUninstall()` → parallel `rscdDetection` → async WMI steps → job progress sockets

### Power
`POST /api/vms/:id/power` or `/api/vms/bulk-power` → `shutdown` via WMI → audit log

## Key modules

| Path | Role |
|------|------|
| `backend/src/utils/audit.js` | Structured audit logging |
| `backend/src/services/endpointOps.js` | Lightbox data + power |
| `backend/src/services/rscdDetection.js` | Parallel RSCD detection |
| `backend/src/services/localUserProvision.js` | Login user provisioning |
| `backend/src/config/operationsCredential.js` | Fixed RDSROOT credential |
| `frontend/src/components/EndpointLightbox.jsx` | Endpoint modal UI |
| `backend/src/services/dashboard.js` | Dashboard widget aggregation |
| `frontend/src/DashboardPage.jsx` | Dashboard card grid |
| `frontend/src/components/ui/*` | Dashboard shell + widget cards |

## WMI timeouts

| Variable | Default |
|----------|---------|
| `WMI_CONNECT_TIMEOUT_MS` | 45000 |
| `WMI_QUERY_TIMEOUT_MS` | 30000 |
| `WMI_STEP_TIMEOUT_MS` | 300000 |
