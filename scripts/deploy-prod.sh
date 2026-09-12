#!/usr/bin/env bash
# RSCD Manager — production deploy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy and edit:"
  echo "  cp .env.production.example .env"
  exit 1
fi

ensure_wmi_relay_env() {
  if grep -q '^WMI_RELAY_URL=' .env 2>/dev/null; then
    return
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "==> Mac detected — enabling WMI relay (Docker cannot run WMI DCOM)"
    {
      echo ""
      echo "# Auto-added for Mac Docker — WMI runs on host"
      echo "WMI_RELAY_URL=http://host.docker.internal:19500"
      echo "WMI_RELAY_PORT=19500"
    } >> .env
  fi
}

ensure_wmi_relay_env

echo "==> Building frontend..."
cd frontend
npm ci
npm run build
cd "$ROOT"

echo "==> Building Docker image..."
docker compose build --no-cache app

echo "==> Starting production stack..."
chmod +x "$ROOT/scripts/compose-up.sh"
"$ROOT/scripts/compose-up.sh" up -d

echo "==> Waiting for health..."
for i in {1..30}; do
  if curl -sf "http://localhost:${APP_PORT:-8080}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo ""
docker compose ps
echo ""
curl -s "http://localhost:${APP_PORT:-8080}/health" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:${APP_PORT:-8080}/health"
echo ""
echo "Production deploy complete → http://localhost:${APP_PORT:-8080}"
echo "Logs: docker compose logs -f app"
