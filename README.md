# RSCD Manager

Windows-only control portal for **BladeLogic RSCD agents** — inventory, WMI health checks, and bulk uninstall jobs across your VM fleet.

**URL:** http://localhost:8080 (Docker `APP_PORT`, mapped to backend port 5000 inside the container)

Do **not** use `http://localhost:5000` on macOS — that port is often taken by AirPlay Receiver.

**Local UI dev** (optional): `cd frontend && npm run dev` → http://localhost:3000 (proxies API to http://127.0.0.1:8080)

## Production deploy

**Windows VM (UI port 80, API port 81):** see [DEPLOY-WINDOWS.md](./DEPLOY-WINDOWS.md) and `.\scripts\deploy-windows.ps1`.

**Linux / Mac Docker (single port 8080):**

```bash
cp .env.production.example .env    # edit credentials & OPERATOR_API_KEY
chmod +x scripts/*.sh
./scripts/deploy-prod.sh
docker compose logs -f app
```

Or manually (on Mac, use `compose-up.sh` so WMI relay starts on the host):

```bash
cd frontend && npm run build && cd ..
./scripts/build-app.sh
# or: ./scripts/compose-up.sh up -d --build
docker compose logs -f app
```

### Mac + Docker (WMI relay)

Docker containers can reach SMB but **WMI DCOM/RPC hangs** inside the container. WMI runs on your **Mac host** via a relay.

Add these to `.env` (not in the shell):

| Variable | Description |
|----------|-------------|
| `APP_PORT` | Web UI port (default `8080`) |
| `WMI_RELAY_URL` | Mac relay URL (default `http://host.docker.internal:19500`) |
| `WMI_RELAY_PORT` | Relay listen port (default `19500`) |
| `WMI_CONNECT_TIMEOUT_MS` | WMI connect timeout (default `45000`) |
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
WMI_RELAY_URL=http://host.docker.internal:19500
WMI_RELAY_PORT=19500
WMI_CONNECT_TIMEOUT_MS=45000
```

Start the stack:

```bash
./scripts/compose-up.sh up -d
```

Relay only (if Docker is already running):

```bash
./scripts/start-wmi-relay.sh
./scripts/stop-wmi-relay.sh
tail -f ~/Projects/rscd-agent-master/logs/wmi-relay.log
```

WMI diagnostics for one VM:

```bash
~/Projects/rscd-agent-master/scripts/wmi-diagnostics.sh vw-pun-domdv079.bmc.com
```

Relay health from app container:

```bash
curl -s http://localhost:8080/api/system/wmi-relay | python3 -m json.tool
```

On **Linux servers on the corporate network**, leave `WMI_RELAY_URL` empty.

WMI credentials: set `RSCD_OS_USERS` as `DOMAIN\user:password` (first entry is used globally). Override per VM under **Edit VM → WMI credentials**.

## Backup

```bash
./scripts/backup.sh
```

Creates `backups/YYYYMMDD-HHMMSS/` with:
- `mongodb.archive.gz` — full database dump
- `rscd-source.tar.gz` — application source
- `.env` — environment (secrets)
- `rscd-backup-*.tar.gz` — single bundle for off-site storage

**Restore full backup (source + .env + database):**

```bash
./scripts/restore-backup.sh 20260910-184600
```

**Restore database only:**

```bash
docker compose exec -T mongodb mongorestore --archive --gzip --drop \
  < backups/<stamp>/mongodb.archive.gz
```

## Workflow

See [docs/WORKFLOW.md](docs/WORKFLOW.md) and [docs/workflow.svg](docs/workflow.svg).

## Usage

1. **VMs** → Import Excel/TXT or Add hosts
2. **Check** / background monitor updates connectivity & agent status
3. **Jobs** → New Job → uninstall agents via WMI
4. **Logs** → real-time activity

## Security (production)

| Setting | Purpose |
|---------|---------|
| `OPERATOR_API_KEY` | Required for uninstall, delete, cancel (header `X-Operator-Key` or operator session cookie) |
| `RSCD_OS_USERS` | WMI credentials (never commit real values) |
| `CORS_ORIGIN` | Restrict browser origin if using a reverse proxy |

Never commit `.env` — it contains credentials. App is intended for internal/trusted networks.

## Environment

Copy `.env.production.example` → `.env`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `8080` | Host port for web UI |
| `MONGODB_URI` | internal | MongoDB connection |
| `MONITOR_INTERVAL_SEC` | `30` | Background check interval |
| `UNINSTALL_CONCURRENCY` | `12` | Parallel uninstall workers |
| `WMI_DNS_SUFFIXES` | corp domains | Expand short hostnames |
| `OPERATOR_API_KEY` | — | Protect destructive APIs |

## Health

```bash
curl http://localhost:8080/health
```

## License

Internal use — BMC Helix RSCD Manager v2.0
