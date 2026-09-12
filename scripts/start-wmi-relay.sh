#!/usr/bin/env bash
# Start WMI relay on the Docker host (required on Mac when WMI DCOM cannot run in containers).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PID_FILE="${ROOT}/logs/wmi-relay.pid"
RELAY_LOG="${ROOT}/logs/wmi-relay.log"
PORT="${WMI_RELAY_PORT:-19500}"
mkdir -p "${ROOT}/logs"

health_ok() {
  curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1
}

if health_ok; then
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "WMI relay already running on port $PORT (pid $pid)"
      echo "Log: $RELAY_LOG"
      exit 0
    fi
  fi
  echo "==> Port $PORT in use but PID file missing — clearing stale listener"
  if command -v lsof >/dev/null 2>&1; then
    stale="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
    if [[ -n "$stale" ]]; then
      echo "$stale" | xargs kill -9 2>/dev/null || true
      sleep 1
    fi
  fi
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  kill "$old_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1; then
  stale="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [[ -n "$stale" ]]; then
    echo "==> Clearing stale process on port $PORT"
    echo "$stale" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 required for WMI relay"
  exit 1
fi

if ! python3 -c "import impacket" 2>/dev/null; then
  echo "==> Installing impacket on host..."
  pip3 install 'impacket==0.12.0' --break-system-packages 2>/dev/null \
    || pip3 install 'impacket==0.12.0' --user
fi

export PATH="${HOME}/.local/bin:${PATH}"
export WMIEXEC_PATH="${WMIEXEC_PATH:-$ROOT/backend/wmiexec.py}"
export WMI_RELAY_PORT="$PORT"
export LOG_LEVEL="${LOG_LEVEL:-info}"
unset WMI_RELAY_URL

if [[ ! -f "$ROOT/backend/node_modules/dotenv/package.json" ]]; then
  echo "==> Installing backend deps for WMI relay..."
  (cd "$ROOT/backend" && npm ci --omit=dev)
fi

if ! python3 "$WMIEXEC_PATH" -h >/dev/null 2>&1; then
  echo "ERROR: wmiexec.py not runnable on host — install impacket: pip3 install 'impacket==0.12.0'"
  exit 1
fi

chmod +x "$ROOT/backend/wmi_probe.py" 2>/dev/null || true

echo "==> Starting WMI relay on port $PORT..."
nohup bash -c "
  cd \"$ROOT\"
  while true; do
    echo \"[\$(date '+%Y-%m-%d %H:%M:%S')] WMI relay starting\" >> \"$RELAY_LOG\"
    node \"$ROOT/backend/src/wmiRelayServer.js\" >> \"$RELAY_LOG\" 2>&1
    echo \"[\$(date '+%Y-%m-%d %H:%M:%S')] WMI relay exited — restart in 2s\" >> \"$RELAY_LOG\"
    sleep 2
  done
" >/dev/null 2>&1 &
echo $! > "$PID_FILE"

for i in {1..15}; do
  if health_ok; then
    echo "WMI relay ready → http://127.0.0.1:${PORT}/health"
    echo "Log: $RELAY_LOG"

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      if docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl:8.5.0 \
        curl -sf --max-time 5 "http://host.docker.internal:${PORT}/health" >/dev/null 2>&1; then
        echo "WMI relay reachable from Docker containers"
      else
        echo "WMI relay running on host (Docker container bridge testing skipped)"
      fi
    else
      echo "WMI relay active locally — start Docker Desktop to enable container reachability"
    fi
    exit 0
  fi
  sleep 1
done

echo "ERROR: WMI relay failed to start — check $RELAY_LOG"
exit 1
