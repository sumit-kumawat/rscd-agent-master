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

echo "==> Building frontend..."
cd frontend
npm ci
npm run build
cd "$ROOT"

echo "==> Building Docker image..."
docker compose build --no-cache app

echo "==> Starting production stack..."
docker compose up -d

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
