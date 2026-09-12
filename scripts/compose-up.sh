#!/usr/bin/env bash
# Wrapper around docker compose — starts WMI relay on the host when required (Mac + VPN).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -n "${WMI_RELAY_URL:-}" ]]; then
  chmod +x "$ROOT/scripts/start-wmi-relay.sh"
  "$ROOT/scripts/start-wmi-relay.sh"

fi

exec docker compose "$@"
