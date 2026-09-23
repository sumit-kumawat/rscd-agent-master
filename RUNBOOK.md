# RSCD Manager — deploy runbook

## Nuclear reset — erase everything and run fresh (Docker)

Removes containers, networks, **and MongoDB volumes**, rebuilds the app image, and starts clean stacks (app + Mongo + WMI relay when configured).

Use **bash** or the script below. In **zsh**, lines starting with `#` are not comments unless you run `setopt interactivecomments` first — pasted `#` lines show `command not found: #`.

**Recommended:**

```bash
cd /path/to/rscd-agent-master
chmod +x scripts/fresh-docker.sh
HOSTS_FILE="$HOME/path/to/your-hosts.txt" ./scripts/fresh-docker.sh
```

Without import: `./scripts/fresh-docker.sh` then import from **Assets → Import** in the UI.

Manual steps (bash):

```bash
cd /path/to/rscd-agent-master

docker compose down -v --remove-orphans

docker rmi rscd-agent-master-app 2>/dev/null || true

export DOCKER_BUILDKIT=1
./scripts/build-app.sh

docker compose ps
curl -s http://localhost:8080/health | jq .

HOSTS_FILE="/absolute/path/to/hosts.txt"
curl -s -X POST http://localhost:8080/api/vms/import \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --rawfile hosts "$HOSTS_FILE" '{hosts: $hosts, replace: true}')"

curl -s -X POST http://localhost:8080/api/system/readiness/ensure \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"remediateUsers":true,"remediateVc":true,"onlineOnly":true}'
```

Single-line variant (same steps):

```bash
cd /path/to/rscd-agent-master && docker compose down -v --remove-orphans && export DOCKER_BUILDKIT=1 && (cd frontend && npm ci && npm run build) && ./scripts/build-app.sh && curl -s http://localhost:8080/health | jq .
```

## Full Docker deploy (required after every UI change)

```bash
cd /path/to/rscd-agent-master
git pull origin main
cd frontend && npm run build && cd ..
chmod +x scripts/build-app.sh
./scripts/build-app.sh
docker compose ps
curl -s http://localhost:8080/health | jq .
```

Portal URL: **http://localhost:8080/dashboard** (also `/vms`, `/jobs`, `/logs`).

## Browser cache

After deploy, use **hard refresh** once: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows).

`index.html` is served with `Cache-Control: no-cache` so asset hashes stay in sync.

## Empty database + import

```bash
cd backend && npm run db:reset
cd ../frontend && npm run build && cd ..
docker compose up -d --build
```

Import hosts from **Assets → Import** (.txt or .xlsx).

## VC++ 2015 x64 (all Windows servers)

Verifies **Microsoft Visual C++ 2015 Redistributable (x64)** (including the 2015–2022 x64 bundle) and installs when missing.

```bash
# Verify + install on every non-excluded Windows VM in inventory
curl -s -X POST http://localhost:8080/api/system/vcredist-2015/ensure \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"install":true}'

# Verify only (no install)
curl -s -X POST http://localhost:8080/api/system/vcredist-2015/ensure \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"install":false}'

# Online hosts only
curl -s -X POST http://localhost:8080/api/system/vcredist-2015/ensure \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"install":true,"onlineOnly":true}'
```

Optional: place `vc_redist.x64.exe` at `backend/data/prerequisites/` (or set `VC_REDIST_2015_X64_LOCAL_PATH`) so hosts without internet use a staged copy from the manager.

Track progress under **Jobs** (`type: vcredist_2015`). Each VM stores `vcRedist2015X64` after a run.

## Pre-deploy readiness task list

Each endpoint **Overview** tab runs three checks (live WMI when online):

1. **RSCD agent uninstalled**
2. **All provision local users** (default: `rdsroot`, `rdsmon`, `administrator` — override with `PROVISION_LOCAL_USERS`)
3. **Microsoft Visual C++ 2015 Redistributable (x64)**

On portal login, provisioning runs first; then readiness is checked fleet-wide. After provisioning, VC++ install is queued for online hosts. Use **Re-check** / **Fix users & VC++** on an endpoint, or fleet API:

```bash
curl -s -X POST http://localhost:8080/api/system/readiness/ensure \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"remediateUsers":true,"remediateVc":true,"onlineOnly":true}'
```

Per-endpoint: `GET /api/vms/:id/readiness`, `POST /api/vms/:id/readiness/ensure` with `{ "users": true, "vcredist": true }`.

## Production TLS (nginx)

```bash
cd frontend && npm run build && cd ..
docker compose -f docker-compose.prod.yml build app --no-cache
docker compose -f docker-compose.prod.yml up -d
```

## Logs

```bash
docker compose logs -f app
```
