#!/usr/bin/env bash
# RSCD Manager — full backup (MongoDB + source + env)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT/backups/$STAMP"
mkdir -p "$BACKUP_DIR"

echo "==> RSCD Manager backup → $BACKUP_DIR"

# MongoDB dump (running container)
if docker compose ps mongodb --status running -q 2>/dev/null | grep -q .; then
  echo "    Dumping MongoDB..."
  docker compose exec -T mongodb mongodump \
    --db="${MONGO_INITDB_DATABASE:-rscd_agent_master}" \
    --archive --gzip \
    > "$BACKUP_DIR/mongodb.archive.gz"
else
  echo "    WARN: MongoDB container not running — skipping DB dump"
fi

# Source code (no node_modules / backups)
echo "    Archiving source..."
tar -czf "$BACKUP_DIR/rscd-source.tar.gz" \
  --exclude='./backups' \
  --exclude='./**/node_modules' \
  --exclude='./frontend/dist' \
  --exclude='./backend/logs' \
  --exclude='./.git' \
  -C "$ROOT" \
  backend frontend docs docker-compose.yml Dockerfile .dockerignore \
  scripts README.md .env.production.example .gitignore 2>/dev/null || true

# Environment (if present — contains secrets)
if [[ -f .env ]]; then
  cp .env "$BACKUP_DIR/.env"
  echo "    Saved .env"
fi

# Manifest
cat > "$BACKUP_DIR/manifest.txt" <<EOF
RSCD Manager Backup
Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Host: $(hostname)
Git: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "no-git")
Files:
$(ls -lh "$BACKUP_DIR")
EOF

# Single downloadable bundle
BUNDLE="$ROOT/backups/rscd-backup-$STAMP.tar.gz"
tar -czf "$BUNDLE" -C "$ROOT/backups" "$STAMP"

echo ""
echo "Backup complete:"
echo "  Folder:  $BACKUP_DIR"
echo "  Bundle:  $BUNDLE"
echo "  Size:    $(du -sh "$BUNDLE" | cut -f1)"
echo ""
echo "Restore all: ./scripts/restore-backup.sh $STAMP"
echo "Restore DB:  docker compose exec -T mongodb mongorestore --archive --gzip --drop < $BACKUP_DIR/mongodb.archive.gz"
