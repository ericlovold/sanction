# The agent wallet

Sanction is the wallet an AI agent carries into a world where most traffic is
agents. MCP, A2A, and payment rails move work and money. None of them answer
whether *this* agent is allowed to do *this*, under whose policy, with what
remaining budget, and whether you can prove it. That object is the wallet.

Identity stays upstream. Sanction consumes it and mints governed runtime
identity — never an identity of record. Payment rails stay rails. Sanction
holds the mandate.

---

## Three surfaces

| Surface | Job | Analog |
|---|---|---|
| **Carry** | The agent *has* the wallet | A card in a pocket, not a tool you remember to open |
| **Present** | The agent shows a bounded mandate | An authorization, not the card number |
| **Verify** | The counterparty checks it | The merchant-side auth |

A human wallet is not a tool you invoke before coffee. The merchant checks the
card. The network authorizes. An agent wallet has to work the same way, or it
will not survive agents that do not share a prompt.

---

## What is shipped (2026-08-16)

- **Carry (stdio).** `npx sanction-mcp` in any MCP host. Ten tools. Cooperative:
  the host must ask before acting. Transport failure fails closed.
- **Carry (URL).** `https://getsanction.com/mcp` — Streamable HTTP, agent API
  key (`x-api-key` or `Authorization: Bearer pxy_...`). Same ten tools.
  Cooperative. This is the paste for Claude / Cursor connectors.
- **Present.** `POST /v1/exec` mints a 15-minute HS256 JWT: credential scope,
  hard spend cap, wallet-bound, freeze-aware. This is a mandate. It was
  documented as credential injection. It is also how a parent agent hires a
  child, or how one agent proves authority to another.
- **Verify.** `POST /v1/mandate/verify` — no API key. The JWT is the capability.
  Counterparties cannot check HS256 locally; they check it here. Frozen,
  revoked, expired, and garbage each have a named status. Invalid is HTTP 200
  `{valid:false}` so agents fail closed on the body.
- **Discover.** `GET /.well-known/wallet-card.json` — the issuer's card. Names
  carry (stdio + URL), present, verify, evidence, and the honesty contract
  (cooperative on stdio and the wallet URL; INTERCEPTED on the LLM gateway
  and on any MCP server fronted by the broker at `/mcp/broker/<upstream>`).

The decision engine, seats, cascade budgets, grants, vault, freeze, and
tamper-evident export were already the wallet. These surfaces make it
presentable.

---

## What is Next (the actual enforcement launch)

**Broker mode.** The agent talks to Sanction; Sanction fronts other MCP
servers and intercepts `tools/call` through the existing `/authorize/tool`
ladder. That is the LLM-gateway pattern for tools. That is what makes "a
hijacked agent cannot spend" true. OAuth onboarding follows the API-key paste.

The broker shipped (BROKER-1): register an upstream with
`POST /v1/broker/upstreams` and point the host at `/mcp/broker/<upstream>` —
every `tools/call` runs the wallet's tool ladder BEFORE it is forwarded, and
the upstream credential lives in the wallet's vault, never with the agent.
Scope the claim honestly: interception holds for brokered traffic; the plain
wallet URL stays cooperative, and traffic that goes straight to an upstream
is not governed. The Wallet Card's `honesty` block says exactly this.

**Per-agent Wallet Cards** (this seat, this remaining budget band, never the
key) attach to A2A Agent Cards so a peer can fetch constraints before a task.

**Decision receipts** — a hash-chained slip both parties keep after a governed
action. AUDIT-1 is wallet-scoped export; A2A needs per-decision.

---

## The year ahead

Agents will fetch, pay, invoke, and hire other agents as ordinary HTTP.
Sites will 402 without a mandate the way they already 402 crawlers. MCP
marketplaces will be untrusted the way npm is. Two agents from two orgs will
meet over A2A and refuse to work without a live wallet.

Sanction's job in that world is not another protocol. It is the object those
protocols present: carry, present, verify, evidence.

---

## The next phase

This slice made the wallet presentable. The next phase makes it the default
path, then the enforcement path.

1. **Hosted remote MCP (v1) — shipped.** A URL the agent is issued —
   Streamable HTTP, API-key. Still cooperative. The install can be a URL.
2. **Broker mode (v1.1).** The agent talks to Sanction; Sanction fronts other
   MCP servers and intercepts `tools/call` through `/authorize/tool`. Same
   shape as the LLM gateway. This is when "hijacked agent cannot spend"
   becomes true.
3. **One A2A demo.** Agent A mints a mandate; agent B verifies before working.
   That demo is the GTM object — not another MCP directory listing.
4. **Per-agent Wallet Cards** attach to A2A Agent Cards. Directory listings
   follow the URL, not the stdio recipe.

Do not add an 11th cooperative tool. Do not invent an A2A competitor. Do not
become an identity provider or a payment rail.

---

## Honesty

stdio MCP and the hosted `/mcp` URL are agent-invoked. Skipping
`sanction_authorize*` is possible — those surfaces stay cooperative. The
LLM gateway and the MCP broker at `/mcp/broker/<name>` are interception:
inference and `tools/call` are authorized before they are forwarded. Traffic
that skips the broker or the gateway is not governed.
