#!/usr/bin/env bash
# Run WMI diagnostics for one VM by name or MongoDB id, then persist status to the database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_URL="${APP_URL:-http://localhost:8080}"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <vm-name-or-mongodb-id>"
  echo "Example: $0 vw-pun-domdv079.bmc.com"
  exit 1
fi

if [[ ${#TARGET} -eq 24 ]]; then
  VM_ID="$TARGET"
else
  VM_ID="$(docker compose exec -T mongodb mongosh --quiet rscd_agent_master --eval \
    "const v=db.vms.findOne({\$or:[{name:'$TARGET'},{fqdn:'$TARGET'}]},{_id:1}); print(v?String(v._id):'')" | tr -d '\r')"
fi

if [[ -z "$VM_ID" ]]; then
  echo "ERROR: VM not found for: $TARGET"
  exit 1
fi

echo "VM id: $VM_ID"
echo "Running WMI diagnostics and updating VM status..."
curl -sf -X POST "${APP_URL}/api/vms/${VM_ID}/diagnostics" | python3 -m json.tool
