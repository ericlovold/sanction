#!/usr/bin/env bash
# Approve (or deny) the oldest pending escalation — the "human in the loop".
#
#   bash scripts/approve.sh           # approve oldest pending
#   bash scripts/approve.sh deny      # deny oldest pending
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${SANCTION_MGMT_KEY:?missing SANCTION_MGMT_KEY (run provision-demo.sh)}"
DECISION="${1:-approve}"

RID=$(curl -s "$SANCTION_API_URL/approvals?wallet_id=$SANCTION_WALLET_ID" \
  -H "x-mgmt-key: $SANCTION_MGMT_KEY" \
  | python3 -c 'import sys,json;p=json.load(sys.stdin).get("pending",[]);print(p[0]["id"] if p else "")')

[ -n "$RID" ] || { echo "no pending approvals"; exit 0; }

echo "▶ $DECISION → $RID"
curl -s -X POST "$SANCTION_API_URL/approvals" -H "x-mgmt-key: $SANCTION_MGMT_KEY" \
  -H "content-type: application/json" \
  -d "{\"wallet_id\":\"$SANCTION_WALLET_ID\",\"request_id\":\"$RID\",\"decision\":\"$DECISION\",\"note\":\"$DECISION by owner (demo)\"}"
echo
