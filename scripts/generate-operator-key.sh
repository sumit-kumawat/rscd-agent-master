#!/usr/bin/env bash
# Generate OPERATOR_API_KEY and write it to .env (does not print the key).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

KEY="$(openssl rand -hex 32)"

if grep -q '^OPERATOR_API_KEY=' "$ENV_FILE"; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/^OPERATOR_API_KEY=.*/OPERATOR_API_KEY=${KEY}/" "$ENV_FILE"
  else
    sed -i "s/^OPERATOR_API_KEY=.*/OPERATOR_API_KEY=${KEY}/" "$ENV_FILE"
  fi
else
  echo "OPERATOR_API_KEY=${KEY}" >> "$ENV_FILE"
fi

echo "OPERATOR_API_KEY set in .env — restart the app: cd $ROOT && docker compose up -d app"
echo "Use header: X-Operator-Key: <value from .env>"
