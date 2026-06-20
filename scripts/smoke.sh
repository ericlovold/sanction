#!/usr/bin/env bash
# End-to-end smoke test against a live Sanction deployment. Creates a throwaway
# wallet and exercises every subsystem, printing PASS/FAIL per check.
#
#   SANCTION_API_URL=https://onesanction.com/api/v1 GOOGLE_API_KEY=... bash scripts/smoke.sh
#
# GOOGLE_API_KEY is optional (skips the live gateway check if absent).
#
# Note: each run creates one wallet, and wallet creation is rate-limited to
# 15/hour/IP — running this in a tight loop from one IP will hit a 429 on the
# create step (and then everything downstream fails). That's the limiter working.
set -uo pipefail

API="${SANCTION_API_URL:-https://onesanction.com/api/v1}"
pass=0; fail=0
J(){ python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
ck(){ # label  expected  actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "Sanction smoke test → $API"

# --- provisioning ---
W=$(curl -s -X POST "$API/wallets" -H "content-type: application/json" -d "{\"name\":\"smoke\",\"owner_email\":\"smoke+$RANDOM$RANDOM@sanction.dev\"}")
WID=$(echo "$W" | J id); MGMT=$(echo "$W" | J management_key)
ck "create wallet" "true" "$([ -n "$WID" ] && echo true || echo false)"
AK=$(curl -s -X POST "$API/agents" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"name\":\"smoke-agent\"}" | J api_key)
ck "register agent" "true" "$([ -n "$AK" ] && echo true || echo false)"
AID=$(curl -s "$API/agents?wallet_id=$WID" -H "x-mgmt-key: $MGMT" | python3 -c "import sys,json;print(json.load(sys.stdin)['agents'][0]['id'])" 2>/dev/null)
curl -s -X PATCH "$API/wallets/policy" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" \
  -d "{\"wallet_id\":\"$WID\",\"per_transaction_max_usd\":50,\"escalate_over_usd\":20,\"daily_spend_budget_usd\":500,\"daily_token_budget_usd\":25,\"blocked_categories\":[\"crypto\"]}" >/dev/null
setpol(){ code -X PATCH "$API/wallets/policy" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"daily_spend_budget_usd\":500}"; }
ck "set policy" "200" "$(setpol)"

az(){ curl -s -X POST "$API/authorize" -H "x-api-key: $AK" -H "content-type: application/json" -d "{\"action\":\"purchase\",\"amount_usd\":$1,\"merchant\":\"M\",\"category\":\"$2\"}" | J status; }
echo "authorize decision engine:"
ck "approve small" "approved" "$(az 8 services)"
ck "deny over per-txn" "denied" "$(az 75 services)"
ck "deny blocked category" "denied" "$(az 5 crypto)"
ck "escalate mid" "escalated" "$(az 30 services)"

echo "token metering:"
ck "log tokens" "200" "$(code -X POST "$API/tokens" -H "x-api-key: $AK" -H "content-type: application/json" -d '{"model":"claude-sonnet-4-6","tokens_in":1000,"tokens_out":500,"cost_usd":0.01,"task":"smoke"}')"

echo "gateway (zero-instrumentation):"
if [ -n "${GOOGLE_API_KEY:-}" ]; then
  GW=$(curl -s -X POST "$API/gateway/gemini/v1beta/models/gemini-flash-latest:generateContent?key=$GOOGLE_API_KEY" -H "x-sanction-key: $AK" -H "content-type: application/json" -d '{"contents":[{"parts":[{"text":"hi"}]}]}')
  ck "gemini via gateway" "true" "$(echo "$GW" | python3 -c "import sys,json;print('true' if json.load(sys.stdin).get('candidates') else 'false')" 2>/dev/null)"
else echo "  ~ skipped (no GOOGLE_API_KEY)"; fi

echo "credential vault:"
curl -s -X POST "$API/credentials/vault" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"label\":\"K\",\"type\":\"api_key\",\"value\":\"secret-xyz\",\"min_clearance\":1}" >/dev/null
EX=$(curl -s -X POST "$API/exec" -H "x-api-key: $AK" -H "content-type: application/json" -d '{"scope":["K"],"budget_usd":10,"ttl_seconds":120}')
JWT=$(echo "$EX" | J jwt); JTI=$(echo "$EX" | J jti)
ck "issue execution token" "true" "$([ -n "$JWT" ] && echo true || echo false)"
ck "inject decrypts secret" "secret-xyz" "$(curl -s -X POST "$API/credentials/inject" -H "authorization: Bearer $JWT" -H "content-type: application/json" -d '{"credential_label":"K"}' | J value)"
ck "inject out-of-scope denied" "403" "$(code -X POST "$API/credentials/inject" -H "authorization: Bearer $JWT" -H "content-type: application/json" -d '{"credential_label":"NOPE"}')"
curl -s -X POST "$API/exec/revoke" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"jti\":\"$JTI\"}" >/dev/null
ck "inject after revoke denied" "401" "$(code -X POST "$API/credentials/inject" -H "authorization: Bearer $JWT" -H "content-type: application/json" -d '{"credential_label":"K"}')"

echo "clearance gate:"
curl -s -X POST "$API/credentials/vault" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"label\":\"HI\",\"type\":\"api_key\",\"value\":\"top\",\"min_clearance\":4}" >/dev/null
curl -s -X PATCH "$API/agents" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"agent_id\":\"$AID\",\"clearance\":2}" >/dev/null
ck "exec denied below clearance" "403" "$(code -X POST "$API/exec" -H "x-api-key: $AK" -H "content-type: application/json" -d '{"scope":["HI"],"budget_usd":5}')"

echo "exec budget cap:"
J2=$(curl -s -X POST "$API/exec" -H "x-api-key: $AK" -H "content-type: application/json" -d '{"scope":["K"],"budget_usd":10}' | J jwt)
azx(){ curl -s -X POST "$API/authorize" -H "x-api-key: $AK" -H "authorization: Bearer $J2" -H "content-type: application/json" -d "{\"action\":\"purchase\",\"amount_usd\":$1,\"merchant\":\"M\",\"category\":\"services\"}" | J code; }
azx 6 >/dev/null   # spent 6
ck "exec cap denies over budget" "EXEC_BUDGET_EXCEEDED" "$(azx 6)"  # 12 > 10

echo "webhooks:"
whreg(){ code -X POST "$API/webhooks" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"url\":\"https://example.com/hook\"}"; }
whbad(){ code -X POST "$API/webhooks" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"url\":\"http://localhost/x\"}"; }
ck "register webhook" "201" "$(whreg)"
ck "reject non-https webhook" "400" "$(whbad)"

echo "approvals:"
PID=$(curl -s "$API/approvals?wallet_id=$WID" -H "x-mgmt-key: $MGMT" | python3 -c "import sys,json;p=json.load(sys.stdin).get('pending',[]);print(p[0]['id'] if p else '')" 2>/dev/null)
resolve(){ curl -s -X POST "$API/approvals" -H "x-mgmt-key: $MGMT" -H "content-type: application/json" -d "{\"wallet_id\":\"$WID\",\"request_id\":\"$PID\",\"decision\":\"approve\"}" | J status; }
ck "resolve escalation" "approved" "$(resolve)"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
