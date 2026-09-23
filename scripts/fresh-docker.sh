#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOSTS_FILE="${HOSTS_FILE:-}"
RUN_READINESS="${RUN_READINESS:-1}"
APP_PORT="${APP_PORT:-8080}"

echo "==> Stopping stack and removing volumes"
docker compose down -v --remove-orphans

echo "==> Removing old app image (ignore errors if missing)"
docker rmi rscd-agent-master-app:latest 2>/dev/null || true

export DOCKER_BUILDKIT=1
chmod +x scripts/build-app.sh scripts/compose-up.sh

echo "==> Building frontend + Docker image + starting containers"
./scripts/build-app.sh

echo "==> Waiting for health on :${APP_PORT}"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${APP_PORT}/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
    curl -sf "http://localhost:${APP_PORT}/health" | jq .
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "ERROR: health check failed after 30 attempts" >&2
    docker compose logs --tail=40 app
    exit 1
  fi
  sleep 2
done

if [[ -n "$HOSTS_FILE" ]]; then
  if [[ ! -f "$HOSTS_FILE" ]]; then
    echo "ERROR: HOSTS_FILE not found: $HOSTS_FILE" >&2
    exit 1
  fi
  echo "==> Importing hosts from $HOSTS_FILE"
  curl -sf -X POST "http://localhost:${APP_PORT}/api/vms/import" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --rawfile hosts "$HOSTS_FILE" '{hosts: $hosts, replace: true}')"
  echo ""
else
  echo "==> Skipping import (set HOSTS_FILE=/path/to/hosts.txt to import)"
fi

if [[ "$RUN_READINESS" == "1" ]]; then
  echo "==> Queue fleet readiness (login to portal first if operator auth is required)"
  curl -sf -X POST "http://localhost:${APP_PORT}/api/system/readiness/ensure" \
    -H 'Content-Type: application/json' \
    -d '{"confirm":true,"remediateUsers":true,"remediateVc":true,"onlineOnly":true}'
  echo ""
fi

echo "Done. Portal: http://localhost:${APP_PORT}/vms"
