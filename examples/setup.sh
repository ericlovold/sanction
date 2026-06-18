#!/usr/bin/env bash
# Create a Sanction wallet + agent for testing, set a demo-friendly policy, and
# print the env exports the agent script needs.
#
#   source <(bash examples/setup.sh)
#   python3 examples/gemini_agent.py
set -euo pipefail

API="${SANCTION_API_URL:-https://onesanction.com/api/v1}"
EMAIL="${1:-test+$RANDOM@sanction.dev}"
py(){ python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }

W=$(curl -s -X POST "$API/wallets" -H "content-type: application/json" \
  -d "{\"name\":\"gemini-test\",\"owner_email\":\"$EMAIL\"}")
WID=$(echo "$W" | py id)
MGMT=$(echo "$W" | py management_key)
AK=$(curl -s -X POST "$API/agents" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" \
  -d "{\"wallet_id\":\"$WID\",\"name\":\"gemini-agent\"}" | py api_key)

# Demo policy: per-txn $50, escalate over $20 (so a $45 charge escalates instead
# of being denied), block crypto. Token budget high enough that logging flows.
curl -s -X PATCH "$API/wallets/policy" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" \
  -d "{\"wallet_id\":\"$WID\",\"per_transaction_max_usd\":50,\"escalate_over_usd\":20,\"daily_spend_budget_usd\":500,\"daily_token_budget_usd\":5,\"blocked_categories\":[\"crypto\",\"gambling\",\"adult\"]}" >/dev/null

echo "export SANCTION_API_URL=\"$API\""
echo "export SANCTION_API_KEY=\"$AK\""
echo "# wallet_id=$WID"
echo "# management_key=$MGMT   (gates approvals + policy edits)"
echo "#"
echo "# Approve escalations with the management key:"
echo "#   curl -s \"$API/approvals?wallet_id=$WID\" -H \"x-mgmt-key: $MGMT\""
echo "#   curl -s -X POST \"$API/approvals\" -H \"x-mgmt-key: $MGMT\" -H content-type:application/json \\"
echo "#     -d '{\"wallet_id\":\"$WID\",\"request_id\":\"<id>\",\"decision\":\"approve\"}'"
