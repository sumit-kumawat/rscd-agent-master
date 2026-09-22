# RSCD Manager — deploy runbook

## Full Docker deploy (required after every UI change)

```bash
cd /path/to/rscd-agent-master
git pull origin main
cd frontend && npm run build && cd ..
docker compose build app --no-cache
docker compose up -d
docker compose ps
curl -s http://localhost:8080/health | jq .
```

Portal URL: **http://localhost:8080/#/dashboard** (hash routes — use `#/vms`, `#/jobs`, `#/logs`).

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
