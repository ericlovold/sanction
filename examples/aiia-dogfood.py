#!/usr/bin/env python3
"""
AIIA Dogfood Example -- Route AIIA (Elo's local agent LLM) through Sanction.

GTM proof: a real agent calling through Sanction so metered calls
show up in the activity dashboard.

Gateway URLs:
  - https://getsanction.com/api/gateway/anthropic  (Claude)
  - https://getsanction.com/api/gateway/openai     (OpenAI)
  - https://getsanction.com/api/gateway/gemini      (Gemini)

Auth header:  x-sanction-key: pxy_...  (agent's key)

Usage:
  export SANCTION_AGENT_KEY=pxy_live_...
  export ANTHROPIC_API_KEY=sk-ant-...
  python aiia-dogfood.py
"""

import os
import json
import httpx

# -- Config --
SANCTION_KEY = os.environ["SANCTION_AGENT_KEY"]
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]

SANCTION_API     = "https://getsanction.com/api/v1"
GATEWAY_ANTHROPIC = "https://getsanction.com/api/gateway/anthropic"

MODEL = "claude-sonnet-4-20250514"


# -- Authorize: pre-spend check --
def authorize(action: str, amount_usd: float, merchant: str, category: str, description: str = "") -> dict:
    """Call Sanction authorize before any spend action."""
    resp = httpx.post(
        f"{SANCTION_API}/authorize",
        headers={
            "Content-Type": "application/json",
            "x-api-key": SANCTION_KEY,
        },
        json={
            "action": action,
            "amount_usd": amount_usd,
            "merchant": merchant,
            "category": category,
            "description": description,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# -- Gateway call: LLM through Sanction --
def chat(prompt: str) -> str:
    """Send a message to Claude via Sanction's gateway proxy."""
    resp = httpx.post(
        f"{GATEWAY_ANTHROPIC}/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-sanction-key": SANCTION_KEY,
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": MODEL,
            "max_tokens": 512,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["content"][0]["text"]


# -- AIIA Agent Loop --
def main():
    print("=== AIIA Dogfood: Sanction Gateway Demo ===\n")

    # Step 1: Ask the agent (through Sanction gateway) for a recommendation
    print("[1] Asking AIIA for a software recommendation (via Sanction gateway)...")
    recommendation = chat(
        "You are AIIA, Elo's local agent. "
        "Recommend one developer tool subscription under $30/month. "
        "Reply with: tool name, monthly cost, and one sentence why."
    )
    print(f"    AIIA says: {recommendation}\n")

    # Step 2: Pre-spend authorization before purchasing
    print("[2] Requesting Sanction authorization for a $25 purchase...")
    decision = authorize(
        action="subscribe",
        amount_usd=25.00,
        merchant="Example SaaS",
        category="software",
        description="Developer tool subscription recommended by AIIA",
    )
    status = decision.get("status", "unknown")
    print(f"    Status: {status}")

    if status == "approved":
        print("    --> Approved. AIIA would proceed with the purchase.\n")
    elif status == "escalated":
        print(f"    --> Escalated to human: {decision.get('reason', 'N/A')}")
        print(f"    --> Remediation: {decision.get('remediation', 'N/A')}\n")
        print("    AIIA pauses and waits for human approval.\n")
    elif status == "denied":
        print(f"    --> Denied: {decision.get('reason', 'N/A')}")
        print(f"    --> Code: {decision.get('code', 'N/A')}")
        print(f"    --> Remediation: {decision.get('remediation', 'N/A')}\n")
        print("    AIIA aborts the purchase and replans.\n")
    else:
        print(f"    --> Unexpected status: {status}\n")

    # Step 3: Another gateway call to confirm
    print("[3] Follow-up call through Sanction gateway...")
    followup = chat("Summarize what AIIA is in one sentence.")
    print(f"    AIIA says: {followup}\n")

    print("=== Done. Check your Sanction dashboard for metered activity. ===")


if __name__ == "__main__":
    main()
