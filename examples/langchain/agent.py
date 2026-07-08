"""Sanction + LangChain — minimal runnable example.

Two first-successes, in order:
  1. a LangChain model call metered through Sanction's gateway
  2. a real /authorize decision (approved / escalated / denied) before a spend

Setup (from the repo root):
  source <(bash examples/setup.sh)        # creates a wallet + agent, exports env
  export ANTHROPIC_API_KEY="sk-ant-..."   # your provider key — forwarded upstream
  pip install -r examples/langchain/requirements.txt
  python3 examples/langchain/agent.py
"""

import os
import sys

import httpx
from langchain_anthropic import ChatAnthropic

API = os.environ.get("SANCTION_API_URL", "https://getsanction.com/api/v1")
AGENT_KEY = os.environ.get("SANCTION_API_KEY")  # pxy_... from examples/setup.sh
if not AGENT_KEY:
    sys.exit("SANCTION_API_KEY not set — run: source <(bash examples/setup.sh)")
if not os.environ.get("ANTHROPIC_API_KEY"):
    sys.exit("ANTHROPIC_API_KEY not set")


# ── 1. Metered model call ────────────────────────────────────────────────────
# The whole integration: point LangChain's provider at the gateway and pass the
# agent key via default_headers. Everything else is normal LangChain.
llm = ChatAnthropic(
    model="claude-haiku-4-5-20251001",
    anthropic_api_url=API.replace("/api/v1", "/api/gateway/anthropic"),
    default_headers={"x-sanction-key": AGENT_KEY},
)

reply = llm.invoke("In one sentence: recommend a CI/CD tool under $50/month.")
print("Model (metered through Sanction):", reply.content)


# ── 2. Pre-spend authorization ───────────────────────────────────────────────
# Before acting on the recommendation, ask the wallet. 403 = denied by policy —
# a decision, not an error.
resp = httpx.post(
    f"{API}/authorize",
    headers={"content-type": "application/json", "x-api-key": AGENT_KEY},
    json={
        "action": "subscribe",
        "amount_usd": 29,
        "merchant": "GitHub Actions",
        "category": "software",
        "description": "CI/CD subscription recommended by the agent",
    },
)
decision = resp.json()

status = decision.get("status")
reason = decision.get("reason", "")
print(f"Authorize $29 subscribe → {status}" + (f" ({reason})" if reason else ""))

if status == "approved":
    print("Proceed with the purchase — the decision is in your audit feed.")
elif status == "escalated":
    print(
        "A human must approve. Poll GET /authorize/"
        f"{decision.get('request_id')} for the grant, then retry with grant_id."
    )
elif status == "denied":
    print("Do not proceed. The policy said no, with the reason above.")
