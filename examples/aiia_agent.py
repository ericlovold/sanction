#!/usr/bin/env python3
"""
Sanction x AIIA — a local agent, governed end-to-end.

Models the AIIA dogfood: a local-brain agent that meters every model call through
Sanction's token budget and asks Sanction before it spends money. The decision it
gets back (approve / escalate / deny) maps directly onto AIIA's execution tiers
(AUTO / SUPERVISED / GATED).

This example is zero-dependency and self-contained: the "model call" is stubbed so
you can run the full governance loop without Ollama/MLX. Swap `local_think()` for a
real call to your local model to make it live.

Run:
    source <(bash examples/setup.sh)      # creates a wallet + agent, prints exports
    python3 examples/aiia_agent.py

Env:
    SANCTION_API_URL     default https://getsanction.com/api/v1
    SANCTION_API_KEY     agent key (pxy_...)                  [required]
    SANCTION_POLL_TRIES  escalation poll attempts (2s each), default 30
"""
import json
import os
import time
import urllib.error
import urllib.request

SANCTION_API = os.environ.get("SANCTION_API_URL", "https://getsanction.com/api/v1")
SANCTION_KEY = os.environ.get("SANCTION_API_KEY", "")
POLL_TRIES = int(os.environ.get("SANCTION_POLL_TRIES", "30"))
PACING = float(os.environ.get("SANCTION_DEMO_PACING", "0"))

# AIIA's execution tiers, named by the decision that produces them.
TIER = {"approved": "AUTO", "escalated": "SUPERVISED", "denied": "GATED"}

# Per-model rates (USD per 1M tokens). A local model is effectively free, but we
# still meter it so the wallet has a complete usage picture.
RATES = {
    "claude-opus-4-8": (15.00, 75.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "local": (0.0, 0.0),
}

if not SANCTION_KEY:
    raise SystemExit("Set SANCTION_API_KEY (run examples/setup.sh first).")


def _req(url, headers, body=None, method="GET"):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def _cost(model, tin, tout):
    rin, rout = RATES.get(model, RATES["local"])
    return round(tin / 1e6 * rin + tout / 1e6 * rout, 6)


def local_think(task):
    """Stand-in for a real local-brain call (Ollama/MLX). Returns (text, tin, tout)."""
    time.sleep(PACING)
    return f"[local-brain output for: {task}]", 1200, 400


def meter(task, model="local"):
    """One model call, metered against the agent's token budget (POST /tokens)."""
    print(f"\n\U0001F916 {task}")
    text, tin, tout = local_think(task)
    cost = _cost(model, tin, tout)
    code, res = _req(f"{SANCTION_API}/tokens", {"x-api-key": SANCTION_KEY},
                     {"model": model, "tokens_in": tin, "tokens_out": tout,
                      "cost_usd": cost, "task": task}, "POST")
    gate = "✓ logged" if code == 200 else f"⛔ {res.get('error')}"
    print(f"   {model}: {text[:90]}")
    print(f"   {tin}+{tout} tok ≈ ${cost:.5f}   [{gate}]")
    return code == 200


def authorize(amount, merchant, category, why):
    """Ask Sanction before spending. The decision maps to an AIIA execution tier."""
    time.sleep(PACING)
    print(f"\n\U0001F4B3 wants ${amount} at {merchant} ({category}) — {why}")
    code, d = _req(f"{SANCTION_API}/authorize", {"x-api-key": SANCTION_KEY},
                   {"action": "purchase", "amount_usd": amount, "merchant": merchant,
                    "category": category, "description": why}, "POST")
    status = d.get("status")

    # SUPERVISED: a human must resolve it. Poll until the request reaches a terminal state.
    if status == "escalated":
        rid = d.get("request_id", "")
        print(f"   ⏸ SUPERVISED — needs a human. Resolve at the dashboard, or:")
        print(f"     POST {SANCTION_API}/approvals  (request_id={rid})")
        for _ in range(POLL_TRIES):
            time.sleep(2)
            _, p = _req(f"{SANCTION_API}/authorize/{rid}", {"x-api-key": SANCTION_KEY})
            if p.get("status") != "escalated":
                d, status = p, p.get("status")
                break

    tier = TIER.get(status, "?")
    icon = {"approved": "✅", "denied": "⛔", "escalated": "⏸"}.get(status, "?")
    reason = f" — {d.get('reason')}" if d.get("reason") else ""
    print(f"   sanction: {icon} {status} [{tier}] {d.get('code') or ''}{reason}")
    if status == "approved":
        print(f"   → AUTO: proceeding with the ${amount} charge.")
    elif status == "denied":
        rem = d.get("remediation")
        print("   → GATED: agent does NOT spend." + (f" remediation: {rem}" if rem else ""))
    return status


if __name__ == "__main__":
    print(f"Sanction × AIIA  ·  {SANCTION_API}")

    # 1) Local model calls — metered against the daily token budget.
    for i in range(1, 4):
        if not meter(f"research-step-{i}", model="local"):
            print("   → token budget exhausted; the agent must stop calling the model.")
            break

    # 2) Spend attempts — each decision maps to an execution tier.
    authorize(8, "GitHub", "software", "Copilot seat")          # AUTO
    authorize(30, "Snowflake", "services", "data contract")     # SUPERVISED (escalates)
    authorize(5, "SomeExchange", "crypto", "buy gas")           # GATED (blocked category)

    print(f"\nDone. Dashboard: {SANCTION_API.replace('/api/v1', '')}")
