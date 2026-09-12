#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="${ROOT}/logs/wmi-relay.pid"
PORT="${WMI_RELAY_PORT:-19500}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  PORT="${WMI_RELAY_PORT:-19500}"
fi

stopped=0

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "Stopped WMI relay wrapper (pid $pid)"
    stopped=1
  fi
  rm -f "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1; then
  listeners="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    echo "$listeners" | xargs kill -9 2>/dev/null || true
    echo "Stopped listener(s) on port $PORT"
    stopped=1
  fi
fi

if [[ "$stopped" -eq 0 ]]; then
  echo "WMI relay not running"
fi
