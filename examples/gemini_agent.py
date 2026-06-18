#!/usr/bin/env python3
"""
Sanction x Gemini — a real autonomous agent, governed.

A Gemini-powered agent that meters every model call through Sanction's token
budget and asks Sanction before it spends money. Approvals, denials, and
escalations come straight from your wallet policy.

Run:
    source <(bash examples/setup.sh)      # creates a wallet + agent, prints exports
    python3 examples/gemini_agent.py

Env:
    SANCTION_API_URL   default https://onesanction.com/api/v1
    SANCTION_API_KEY   agent key (pxy_...)         [required]
    GOOGLE_API_KEY     your Gemini key             [required]
    GEMINI_MODEL       default gemini-flash-latest
    SANCTION_POLL_TRIES  escalation poll attempts (2s each), default 30
"""
import json
import os
import time
import urllib.error
import urllib.request

SANCTION_API = os.environ.get("SANCTION_API_URL", "https://onesanction.com/api/v1")
SANCTION_KEY = os.environ.get("SANCTION_API_KEY", "")
GOOGLE_KEY = os.environ.get("GOOGLE_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
POLL_TRIES = int(os.environ.get("SANCTION_POLL_TRIES", "30"))
PACING = float(os.environ.get("SANCTION_DEMO_PACING", "0"))  # seconds between steps, for recording

# Rough Gemini Flash pricing per 1M tokens (USD). Override to taste.
IN_RATE = float(os.environ.get("GEMINI_IN_PER_M", "0.075"))
OUT_RATE = float(os.environ.get("GEMINI_OUT_PER_M", "0.30"))

if not SANCTION_KEY or not GOOGLE_KEY:
    raise SystemExit("Set SANCTION_API_KEY and GOOGLE_API_KEY (run examples/setup.sh first).")


def _req(url, headers, body=None, method="GET"):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def gemini(prompt):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={GOOGLE_KEY}"
    code, d = _req(url, {}, {"contents": [{"parts": [{"text": prompt}]}]}, "POST")
    if code != 200:
        raise SystemExit(f"Gemini error {code}: {json.dumps(d)[:300]}")
    text = d["candidates"][0]["content"]["parts"][0]["text"]
    return text, d.get("usageMetadata", {})


def think(task, prompt):
    """One real Gemini call, metered through Sanction's token budget."""
    time.sleep(PACING)
    print(f"\n\U0001F916 {task}")
    text, usage = gemini(prompt)
    tin, tout = usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0)
    cost = round(tin / 1e6 * IN_RATE + tout / 1e6 * OUT_RATE, 6)
    code, res = _req(f"{SANCTION_API}/tokens", {"x-api-key": SANCTION_KEY},
                     {"model": MODEL, "tokens_in": tin, "tokens_out": tout, "cost_usd": cost, "task": task}, "POST")
    gate = "✓ logged" if code == 200 else f"⛔ {res.get('error')}"
    print(f"   gemini: {text.strip()[:110]}")
    print(f"   {tin}+{tout} tok ≈ ${cost:.5f}   [{gate}]")
    return code == 200


def buy(amount, merchant, category, why):
    """Ask Sanction before spending. Honors approve / escalate / deny."""
    time.sleep(PACING)
    print(f"\n\U0001F4B3 wants ${amount} at {merchant} ({category}) — {why}")
    code, d = _req(f"{SANCTION_API}/authorize", {"x-api-key": SANCTION_KEY},
                   {"action": "purchase", "amount_usd": amount, "merchant": merchant,
                    "category": category, "description": why}, "POST")
    status = d.get("status")
    if status == "escalated":
        rid = d.get("request_id", "")
        print(f"   ⏸ escalated — needs a human. Approve at the dashboard, or:")
        print(f"     POST {SANCTION_API}/approvals  (request_id={rid})")
        for _ in range(POLL_TRIES):
            time.sleep(2)
            _, p = _req(f"{SANCTION_API}/authorize/{rid}", {"x-api-key": SANCTION_KEY})
            if p.get("status") != "escalated":
                d, status = p, p.get("status")
                break
    icon = {"approved": "✅", "denied": "⛔", "escalated": "⏸"}.get(status, "?")
    reason = f" — {d.get('reason')}" if d.get("reason") else ""
    print(f"   sanction: {icon} {status} {d.get('code') or ''}{reason}")
    if status == "approved":
        print(f"   → proceeding with the ${amount} charge.")
    elif status == "denied":
        print("   → blocked. The agent does NOT spend.")
    return status


if __name__ == "__main__":
    print(f"Sanction × Gemini  ·  model={MODEL}  ·  {SANCTION_API}")

    # 1) Real model calls — each one metered against the agent's token budget.
    for i in range(1, 4):
        if not think(f"research-step-{i}",
                     "In one short sentence, name a SaaS tool an autonomous ops agent might subscribe to."):
            print("   → token budget exhausted; the agent must stop calling the model.")
            break

    # 2) Spend attempts — gated by policy (approve / escalate / deny).
    buy(8, "GitHub", "software", "Copilot seat")
    buy(45, "Snowflake", "services", "annual data contract")
    buy(5, "QuickSwap", "crypto", "buy gas")

    print(f"\nDone. Dashboard: {SANCTION_API.replace('/api/v1', '/dashboard/spend')}")
