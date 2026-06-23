<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Sanction — Project Context for AI Sessions

## What This Is

**Sanction** is the trust and governance layer for autonomous AI agents. Think of it as the agent's financial identity — a wallet, credential vault, and clearance system that travels with the agent wherever it operates.

**Core concept:** Before an agent spends money, accesses credentials, or operates in a sensitive domain — it asks Sanction. Sanction decides, logs, and audits everything.

**Tagline:** *Authorize. Protect. Govern.*

## The Three Pillars

| Pillar | What it does |
|--------|-------------|
| **Agent Wallet** | Spend authorization with policy enforcement. Auto-approve under threshold, escalate over it, deny what's blocked. Daily/monthly budgets. |
| **Credential Vault** | AES-256-GCM encrypted credentials. Scoped execution JWTs (15min TTL) gate every injection. Every access is audit-logged. |
| **Clearance Levels** | 1-5 clearance system. Industry-specific domain authorization. Agents only access what they're cleared for. |

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack) + TypeScript
- **Database:** Neon (Postgres via Prisma 7 with `@prisma/adapter-pg`)
- **Hosting:** Vercel (`lovold` account, project `proxy-ai`)
- **Auth:** SHA-256 hashed API keys (`pxy_` prefix), JWT execution tokens (jose, HS256)
- **Encryption:** AES-256-GCM for credentials at rest
- **MCP:** Bundled stdio server (`mcp-server.js`) — 5 tools for agent hosts

## Key Files

```
app/
  page.tsx                    — Dashboard (server component, reads live DB)
  api/v1/
    wallets/route.ts          — POST create wallet + policy
    wallets/stats/route.ts    — GET dashboard stats
    agents/route.ts           — POST register agent, GET list
    authorize/route.ts        — POST spend authorization (core policy engine)
    tokens/route.ts           — POST log LLM token usage
    exec/route.ts             — POST issue scoped execution JWT
    credentials/vault/route.ts — POST store encrypted credential
    credentials/inject/route.ts — POST inject credential (requires Bearer JWT)
  api/openapi.json/route.ts   — GET OpenAPI spec (Bedrock compatible)
lib/
  db.ts                       — Prisma client singleton
  jwt.ts                      — issueExecutionJWT / verifyExecutionJWT / AES encryption
  auth.ts                     — authenticateAgent() via x-api-key header
  apiKey.ts                   — generateApiKey() → pxy_ prefix
  openapi.ts                  — Full OpenAPI 3.0 spec object
prisma/
  schema.prisma               — Data model
  config.ts                   — Prisma 7 adapter config
mcp-server.ts                 — MCP stdio server source
mcp-server.js                 — Bundled MCP server (run this)
```

## API Auth

- **Agent API calls:** `x-api-key: pxy_...` header
- **Credential injection:** `Authorization: Bearer <execution-jwt>` (issued by POST /exec)
- **Dashboard:** reads `SANCTION_WALLET_ID` env var server-side

## Environment Variables

```
DATABASE_URL                      — Neon connection string (from Vercel integration)
SANCTION_SIGNING_SECRET           — JWT signing key (base64)
SANCTION_CREDENTIAL_ENCRYPTION_KEY — AES-256 encryption key (base64)
SANCTION_WALLET_ID                — Primary wallet ID (for dashboard)
```

## Live Production

- **API:** `https://getsanction.com/api/v1`
- **Dashboard:** `https://getsanction.com`
- **OpenAPI spec:** `https://getsanction.com/api/openapi.json`
- **Bedrock Agent:** `JXRNIJRMCX` (us-east-1), Action Group `sanction-api`
- **GitHub:** `github.com/ericlovold/sanction`
- **npm:** `sanction-mcp` (published; `npx sanction-mcp`)
- **Canonical domain:** `getsanction.com` (`sanction.ai` not pursued — cost)

## AIIA Integration

AIIA (the Mac Mini AI agent) is the first Sanction client. Integration lives in:
- `~/aiia-brain/AIIA-public/local_brain/sanction.py` — fire-and-forget token logging client
- `~/aiia-brain/AIIA-public/.env` — `SANCTION_API_URL`, `SANCTION_API_KEY`, `SANCTION_WALLET_ID`

## Business Context

- Owner: Eric Lovold (solo founder), Vercel account `lovold`
- Primary agent: AIIA Brain. Live wallet/agent identifiers are NOT committed — see
  Vercel env vars (`SANCTION_WALLET_ID`) and the secrets store. Never commit
  production wallet ids or API keys to the repo.
- Distribution: MCP (npm), AWS Bedrock Action Groups, direct REST API
- Model: Freemium SaaS — Free / $19 Pro / $49 Team / Enterprise

## Design Direction

- Dark theme, zinc/slate palette
- Minimal, serious, enterprise-appropriate — not playful
- Data-dense dashboard — operators want numbers, not marketing copy
- Brand: Sanction = authorized + constrained. Trust through limits.
