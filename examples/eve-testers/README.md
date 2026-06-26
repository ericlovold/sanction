# Sanction × eve — a suite of agent testers

Four [Vercel **eve**](https://eve.dev) agents that put **Sanction** through its
paces: they try to spend money, burn token budgets, and pull secrets — and Sanction
governs every move. Built as a **live demo**: watch autonomous agents (one of them
adversarial) get approved, escalated, and denied in real time.

| Agent | Exercises | The moment |
|-------|-----------|------------|
| 🛒 **shopper** | `sanction_authorize` | auto-approve → escalate → deny, live |
| 📚 **researcher** | `sanction_log_tokens`, `sanction_wallet_status` | burns the budget until Sanction cuts it off |
| 🔧 **operator** | `sanction_request_execution`, `sanction_inject_credential` | scoped-JWT secret access |
| 🦹 **redteam** | every deny path | tries to break out — Sanction holds |

A root **orchestrator** delegates to the four as eve subagents (and can run any
scenario itself).

## How it's wired

eve only speaks **remote** MCP (Streamable HTTP / SSE), but `sanction-mcp` is a
**stdio** server. So we bridge it:

```
eve agent ──(streamable-http)──▶ supergateway ──(stdio)──▶ npx sanction-mcp ──▶ getsanction.com
```

`scripts/start-bridge.sh` runs the bridge; `agent/connections/sanction.ts` points eve
at it. Tools arrive namespaced as `sanction__sanction_authorize`, etc.

## Quickstart

```bash
cd examples/eve-testers
npm install

# 1. Provision a fresh wallet + agent + demo policy + vaulted creds → writes .env
bash scripts/provision-demo.sh
#    then put your ANTHROPIC_API_KEY (eve's model) in .env

# 2. Start the MCP bridge (leave running)
bash scripts/start-bridge.sh

# 3. Start the eve agents (another terminal)
npm run dev

# 4. Drive the demo (another terminal) — or just type into the eve TUI
bash scripts/run-scenarios.sh all
```

When the shopper's $35 charge **escalates**, approve it as the human:

```bash
bash scripts/approve.sh          # or click Approve in the dashboard
```

See **[scenarios/SCENARIOS.md](scenarios/SCENARIOS.md)** for the full scenario matrix
and the demo policy thresholds.

## Requirements

- Node 24+ (eve requirement), `npm`
- An `ANTHROPIC_API_KEY` (or set `EVE_MODEL` to another provider eve supports)
- `npx` access to `sanction-mcp` and `supergateway` (both fetched on demand)

## Notes & knobs

| Env | Default | Purpose |
|-----|---------|---------|
| `SANCTION_API_URL` | `https://getsanction.com/api/v1` | point at local `npm run dev` to demo offline |
| `SANCTION_MCP_URL` | `http://127.0.0.1:8808/mcp` | where eve reaches the bridge |
| `SANCTION_MCP_PORT` | `8808` | bridge port |
| `EVE_MODEL` | `anthropic/claude-sonnet-4.6` | eve's reasoning model |
| `EVE_URL` | `http://127.0.0.1:3000` | eve dev server (for the scenario driver) |

> If your `supergateway` build exposes **SSE** rather than `/mcp`, set
> `SANCTION_MCP_URL=http://127.0.0.1:8808/sse` and drop `--outputTransport` in
> `scripts/start-bridge.sh` (a comment in that file explains).

This example is **safe to run live**: the vaulted credentials are dummies and all
spend is authorization-only (no real charges leave Sanction).
