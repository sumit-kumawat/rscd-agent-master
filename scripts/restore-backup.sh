#!/usr/bin/env bash
# Restore RSCD Manager from a backup folder (source + .env + MongoDB).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="${1:-20260910-184600}"
BACKUP_DIR="$ROOT/backups/$STAMP"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "ERROR: Backup not found: $BACKUP_DIR"
  echo "Available:"
  ls -1 "$ROOT/backups" | grep -E '^[0-9]' || true
  exit 1
fi

echo "==> Restoring from $BACKUP_DIR"

# Stop WMI relay if running (not part of working backup)
if [[ -x "$ROOT/scripts/stop-wmi-relay.sh" ]]; then
  "$ROOT/scripts/stop-wmi-relay.sh" || true
fi

echo "==> Stopping containers..."
docker compose down 2>/dev/null || true

if [[ -f "$BACKUP_DIR/rscd-source.tar.gz" ]]; then
  echo "==> Restoring source code..."
  tar -xzf "$BACKUP_DIR/rscd-source.tar.gz" -C "$ROOT"
fi

if [[ -f "$BACKUP_DIR/.env" ]]; then
  echo "==> Restoring .env..."
  cp "$BACKUP_DIR/.env" "$ROOT/.env"
fi

echo "==> Building frontend..."
cd "$ROOT/frontend"
npm run build
cd "$ROOT"

echo "==> Building and starting Docker stack..."
docker compose build --no-cache app
chmod +x "$ROOT/scripts/compose-up.sh" "$ROOT/scripts/start-wmi-relay.sh" "$ROOT/scripts/stop-wmi-relay.sh" 2>/dev/null || true
"$ROOT/scripts/compose-up.sh" up -d

if [[ -f "$BACKUP_DIR/mongodb.archive.gz" ]]; then
  echo "==> Waiting for MongoDB..."
  for i in {1..30}; do
    if docker compose exec -T mongodb mongosh --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null | grep -q 1; then
      break
    fi
    sleep 2
  done
  echo "==> Restoring MongoDB..."
  docker compose exec -T mongodb mongorestore --archive --gzip --drop \
    < "$BACKUP_DIR/mongodb.archive.gz"
fi

echo ""
docker compose ps
echo ""
echo "Restore complete from backup $STAMP"
echo "App → http://localhost:${APP_PORT:-8080}"
echo "Logs: docker compose logs -f app"
