# RSCD Manager — Windows VM production

**Portal (UI):** `http://<vm-hostname>/` → port **80**  
**API / health:** `http://<vm-hostname>:81/health` → port **81**

Stack: **MongoDB** + **Node API** + **nginx** serving the built React app. All services use `restart: unless-stopped`.

## Prerequisites

1. **Windows Server or Windows 10/11** with [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Linux containers).
2. **Firewall:** allow inbound TCP **80** and **81** (and WMI relay port if used).
3. **Ports 80/81** not used by IIS or other apps (or change `FRONTEND_PORT` / `BACKEND_PORT` in `.env`).

## One-time setup

```powershell
cd C:\path\to\rscd-agent-master
copy .env.windows.example .env
notepad .env
```

Set `RSCD_OS_USERS`, `OPERATOR_API_KEY`, domain/DNS suffixes, and optional `CORS_ORIGIN` to your VM URL.

## Deploy / upgrade

```powershell
cd C:\path\to\rscd-agent-master
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1
```

Manual equivalent:

```powershell
cd frontend
$env:VITE_BACKEND_PORT = "81"
npm ci
npm run build
cd ..
$env:DOCKER_BUILDKIT = "1"
docker compose -f docker-compose.windows.yml build app
docker compose -f docker-compose.windows.yml up -d
```

## Autostart after reboot

1. **Docker Desktop** → Settings → General → **Start Docker Desktop when you sign in**.
2. **Scheduled task** (run **PowerShell as Administrator**):

```powershell
cd C:\path\to\rscd-agent-master
powershell -ExecutionPolicy Bypass -File .\scripts\windows\register-autostart.ps1
```

Containers already use `restart: unless-stopped`; the task runs `docker compose up -d` after boot so stacks come back if Docker was stopped.

## Verify

```powershell
curl http://localhost/
curl http://localhost:81/health
docker compose -f docker-compose.windows.yml ps
```

## Import fleet

```powershell
curl.exe -s -X POST http://localhost:81/api/vms/import -F "file=@C:\Users\you\Downloads\VMs.txt" -F "replace=true"
```

Or use **Assets → Import** in the portal on port 80.

## WMI on Windows Docker

- Corporate network: often **no relay** — leave `WMI_RELAY_URL` empty.
- If WMI from the container fails, run a relay on the Windows host and set  
  `WMI_RELAY_URL=http://host.docker.internal:19500` in `.env`.

## Logs / stop

```powershell
docker compose -f docker-compose.windows.yml logs -f app
docker compose -f docker-compose.windows.yml down
docker compose -f docker-compose.windows.yml down -v   # wipes Mongo data
```

## Optional TLS later

Use a reverse proxy (IIS ARR, Caddy, or `docker-compose.prod.yml` with certs) in front of port 80, or terminate TLS on nginx and keep API internal.
