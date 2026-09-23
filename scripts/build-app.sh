#!/usr/bin/env bash
# Fast app image build: uses Docker layer + apt/pip/npm caches (do not use --no-cache unless debugging).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DOCKER_BUILDKIT=1

NO_CACHE=""
if [[ "${1:-}" == "--no-cache" ]]; then
  NO_CACHE="--no-cache"
  shift
  echo "WARNING: --no-cache rebuilds apt/pip (~10–20 min on slow networks). Prefer plain ./scripts/build-app.sh"
fi

echo "Building frontend into backend/public …"
(cd frontend && npm run build)

echo "Building Docker image (cached layers when possible) …"
docker compose build app ${NO_CACHE:+$NO_CACHE}

docker compose up -d "$@"

PORT="${APP_PORT:-8080}"
echo "Waiting for health on :${PORT} …"
for i in $(seq 1 25); do
  if body="$(curl -sf "http://localhost:${PORT}/health" 2>/dev/null)"; then
    echo "Health: ${body}"
    exit 0
  fi
  sleep 2
done
echo "WARNING: health endpoint not ready yet — try: curl -s http://localhost:${PORT}/health | jq ."
