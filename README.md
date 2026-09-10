# RSCD Manager

Windows-only control portal for **BMC BladeLogic RSCD agents** — inventory, WMI health checks, and bulk uninstall jobs across your VM fleet.

Developed by [Sumit Kumawat](https://www.sumitkumawat.com)

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2
- Network access from the app host to Windows VMs on **WMI ports 135 / 445**
- WMI credentials for target hosts (`rdsroot`, `rdsmon`, `Administrator`, etc.)

---

## Quick start (Docker — recommended)

```bash
# 1. Clone
git clone https://github.com/sumit-kumawat/rscd-agent-master.git
cd rscd-agent-master

# 2. Configure environment
cp .env.production.example .env
# Edit .env — set RSCD_OS_USERS and optionally OPERATOR_API_KEY

# 3. Build & run
chmod +x scripts/*.sh
./scripts/deploy-prod.sh

# 4. Open the app
open http://localhost:8080
```

**Follow logs:**

```bash
docker compose logs -f app
```

**Health check:**

```bash
curl http://localhost:8080/health
```

---

## Manual deploy steps

```bash
cd frontend && npm run build && cd ..
docker compose build --no-cache app
docker compose up -d
docker compose logs -f app
```

---

## Configuration (`.env`)

Copy `.env.production.example` to `.env` and edit:

| Variable | Description |
|----------|-------------|
| `APP_PORT` | Web UI port (default `8080`) |
| `RSCD_OS_USERS` | WMI credentials — `user:password` comma-separated |
| `WMI_DEFAULT_DOMAIN` | AD domain for WMI (e.g. `CORP`) |
| `WMI_DNS_SUFFIXES` | Expand short hostnames (`test-vm.example.com`) |
| `MONITOR_INTERVAL_SEC` | Background check interval (default `30`) |
| `MONITOR_CONCURRENCY` | Parallel monitor workers (default `30`) |
| `UNINSTALL_CONCURRENCY` | Parallel uninstall workers (default `20`) |
| `OPERATOR_API_KEY` | Protects uninstall / delete / cancel APIs |

Example credentials line (use quotes — passwords may contain `$`):

```env
RSCD_OS_USERS='rdsroot:YOUR_PASS,rdsmon:YOUR_PASS,Administrator:YOUR_PASS'
```

---

## Usage

1. Open **http://localhost:8080**
2. **VMs** → Add host or Import `.txt` / `.xlsx`
   - Status is checked **immediately** in the background after add/import
3. Use **Check** on a row or **Check All** for manual refresh
4. **Jobs** → **New Job** → bulk uninstall via WMI
5. **Logs** → real-time activity feed

### Agent status rules

| Status | Meaning |
|--------|---------|
| **Active** (red) | RSCD agent detected on host |
| **Removed** (green) | Agent uninstalled / not present |

When agent is **Removed**, **Edit** and **Delete** are disabled for that record.

---

## Backup & restore

**Create backup:**

```bash
./scripts/backup.sh
```

Output: `backups/rscd-backup-YYYYMMDD-HHMMSS.tar.gz`

**Restore database:**

```bash
gunzip -c backups/<stamp>/mongodb.archive.gz | \
  docker compose exec -T mongodb mongorestore --archive --gzip --drop
```

---

## Stop / restart

```bash
docker compose down          # stop
docker compose up -d         # start
docker compose restart app   # restart app only
```

---

## Architecture

- **Frontend:** React + Vite → served by Express
- **Backend:** Node.js + Express + Socket.IO
- **Database:** MongoDB
- **Remote ops:** WMI only (`wmiexec.py` + impacket)

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the execution flow diagram.

---

## Local development (without Docker)

**Requirements:** Node.js 20+, MongoDB running locally

```bash
# Backend
cd backend && npm install
export MONGODB_URI=mongodb://localhost:27017/rscd_agent_master
export RSCD_OS_USERS='rdsroot:pass,rdsmon:pass'
npm run dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
# UI at http://localhost:3000 (proxies API to :5000)
```

---

## Security notes

- Never commit `.env` — it contains credentials
- Set `OPERATOR_API_KEY` in production; pass as header `X-Operator-Key` for destructive actions
- App is intended for internal/trusted networks
