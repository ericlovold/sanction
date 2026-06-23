#!/usr/bin/env bash
# One-take, recordable demo: an autonomous Gemini agent, governed by Sanction.
# Provisions a fresh wallet, runs the agent at a readable pace, and auto-approves
# the escalation mid-run (simulating you clicking Approve) so the full arc plays
# in ~60 seconds.
#
#   export GOOGLE_API_KEY=...        # you already have this
#   bash examples/demo.sh
#
# For a split-screen take where YOU click Approve in the dashboard instead,
# set NO_AUTO_APPROVE=1 and open the Approvals tab (see examples/DEMO.md).
set -euo pipefail

API="${SANCTION_API_URL:-https://getsanction.com/api/v1}"
: "${GOOGLE_API_KEY:?Set GOOGLE_API_KEY first}"
py(){ python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }

clear
cat <<'BANNER'

   ███  SANCTION × GEMINI
        An autonomous agent — governed.

   It meters every model call, and asks before it spends a cent.

BANNER
sleep 2.5

echo "› provisioning a wallet + agent…"
W=$(curl -s -X POST "$API/wallets" -H "content-type: application/json" -d "{\"name\":\"demo\",\"owner_email\":\"demo+$RANDOM@sanction.dev\"}")
WID=$(echo "$W" | py id); MGMT=$(echo "$W" | py management_key)
AK=$(curl -s -X POST "$API/agents" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"name\":\"gemini-agent\"}" | py api_key)
curl -s -X PATCH "$API/wallets/policy" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" \
  -d "{\"wallet_id\":\"$WID\",\"per_transaction_max_usd\":50,\"escalate_over_usd\":20,\"daily_spend_budget_usd\":500,\"blocked_categories\":[\"crypto\",\"gambling\",\"adult\"]}" >/dev/null
echo "  policy → auto-approve under \$20 · escalate \$20–50 · deny over \$50 · no crypto"
sleep 2.5

if [ -z "${NO_AUTO_APPROVE:-}" ]; then
  # Watch for the escalation and approve it after a beat — the "human in the loop".
  ( for _ in $(seq 1 40); do
      RID=$(curl -s "$API/approvals?wallet_id=$WID" -H "x-mgmt-key: $MGMT" | python3 -c 'import sys,json;p=json.load(sys.stdin).get("pending",[]);print(p[0]["id"] if p else "")' 2>/dev/null || true)
      if [ -n "$RID" ]; then sleep 3
        curl -s -X POST "$API/approvals" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" \
          -d "{\"wallet_id\":\"$WID\",\"request_id\":\"$RID\",\"decision\":\"approve\",\"note\":\"approved by owner\"}" >/dev/null
        break
      fi
      sleep 1
    done ) &
fi

SANCTION_API_URL="$API" SANCTION_API_KEY="$AK" SANCTION_DEMO_PACING="${SANCTION_DEMO_PACING:-1.3}" SANCTION_POLL_TRIES=40 \
  python3 examples/gemini_agent.py
wait 2>/dev/null || true

echo
echo "› see it all on the dashboard: ${API%/api/v1}/dashboard/spend"
