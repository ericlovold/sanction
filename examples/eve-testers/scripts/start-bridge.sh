#!/usr/bin/env bash
# Bridge the published stdio `sanction-mcp` over Streamable HTTP so eve (which
# only speaks remote MCP) can reach it. Uses supergateway.
#
#   bash scripts/start-bridge.sh
#
# Leave this running in its own terminal for the duration of the demo.
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${SANCTION_API_KEY:?run scripts/provision-demo.sh first (SANCTION_API_KEY missing)}"
export SANCTION_API_URL="${SANCTION_API_URL:-https://getsanction.com/api/v1}"
export SANCTION_WALLET_ID="${SANCTION_WALLET_ID:-}"
PORT="${SANCTION_MCP_PORT:-8808}"

echo "▶ bridge: http://127.0.0.1:$PORT/mcp  →  npx sanction-mcp  →  $SANCTION_API_URL"
echo "  (supergateway passes SANCTION_* env through to the stdio server)"
echo

# supergateway inherits this process's env, so sanction-mcp sees SANCTION_API_KEY etc.
# If your supergateway version exposes SSE instead of /mcp, set the eve connection
# URL (SANCTION_MCP_URL) to http://127.0.0.1:$PORT/sse and drop --outputTransport.
exec npx -y supergateway \
  --stdio "npx -y sanction-mcp" \
  --outputTransport streamableHttp \
  --port "$PORT"
