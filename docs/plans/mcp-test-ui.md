# MCP Testing UI — build spec (weekend WS3)

> Prep by Fable, 2026-07-18. Audit sources: `mcp-server.ts` @ e867524 (v0.7.0,
> 10 tools), `examples/eve-testers/*` (bridge + provisioning + approval scripts),
> `lib/gateway.ts` (provider/pricing table). Goal: Saturday starts at "write the
> UI," not "figure out the wiring." Timebox 4h; ship what works by hour 4.

## What exists (verified)

- **`sanction-mcp` v0.7.0** — stdio server, thin typed wrappers over `/api/v1`.
  Auth: `SANCTION_API_KEY` (`pxy_…`) as `x-api-key`; optional `SANCTION_WALLET_ID`,
  `SANCTION_API_URL` (point at `npm run dev` for offline). Fail-closed transport:
  network/non-JSON → `{authorized:false, code:"SANCTION_UNREACHABLE"}`.
- **The contracts worth testing live in the server's renderers** (`renderAuthResult`):
  ✓ authorized (+request_id, grant-consumed marker), ✗ ESCALATED (poll instruction),
  ✗ DENIED (status+code+reason), ✗ non-policy error surfaced verbatim (bad key,
  validation, WALLET_FROZEN — must NOT read as policy denial). A UI that bypasses
  the MCP server and hits REST directly tests the wrong thing.
- **Bridge**: `scripts/start-bridge.sh` → supergateway, stdio→streamableHttp on
  `:8808/mcp` (SSE fallback documented). Env passthrough works.
- **Provisioning**: `scripts/provision-demo.sh` mints demo wallet + `pxy_` key +
  `SANCTION_MGMT_KEY`; **safe to run live** (dummy credentials, authorization-only).
- **Human loop**: `POST /approvals` with `x-mgmt-key` approves/denies oldest
  pending (`scripts/approve.sh`) — the UI can embed this to close the grant loop.

## Architecture (decision made — contest in PR if wrong)

**A dev-gated route in the Next app: `app/dev/mcp-tester`.** Server-side API route
acts as the MCP *host* using `@modelcontextprotocol/sdk` client:

- **Transport A (default, local dev):** spawn `npx -y sanction-mcp` as a stdio
  child from the API route — no bridge needed, env from `.env`.
- **Transport B (toggle):** streamableHttp client → `SANCTION_MCP_URL`
  (`:8808/mcp`) — exercises the exact bridge eve uses, and later the hosted
  remote MCP (the backlogged enterprise on-ramp gets its test surface for free).

Browser talks only to our API route (`POST /api/dev/mcp-tester/call`,
`{tool, args, transport}`); no CORS, keys stay server-side. Gate the route to
`NODE_ENV=development` OR admin session — never ship open in prod.

## UI components (4, keep it flat)

1. **ToolSelector** — the 10 tools; on select, render the schema-driven form.
   Mirror input schemas as a JSON manifest (`lib/mcpToolManifest.ts`) generated
   from the zod defs — do NOT hand-copy 10 forms.
2. **InputPanel** — schema form + a "Scenario" dropdown of canned payloads
   (matrix below) + raw-JSON override toggle.
3. **ResponseViewer** — raw MCP result + parsed contract strip:
   `authorized / status / code / reason / request_id / isError`, latency ms.
   Escalated responses grow a **"Poll grant"** button (`sanction_check_authorization`)
   and an **"Approve / Deny as owner"** button (`/approvals` via mgmt key) —
   the full loop in one screen.
4. **RunBar** — model selector (from `lib/gateway.ts` providers: anthropic /
   openai / gemini + PRICING model list — feeds `sanction_log_tokens` payloads
   and the Dreamscapes routing test), transport toggle, "Run all scenarios"
   with per-row ✓/✗ against expected outcome.

## Scenario matrix (the pass/fail spine)

| # | Tool | Payload sketch | Expect |
|---|------|----------------|--------|
| 1 | authorize | purchase $5 software 'Anthropic' | ✓ authorized |
| 2 | authorize | purchase $500 infrastructure | ✗ escalated → approve → grant retry ✓ |
| 3 | authorize | blocked category (per demo policy) | ✗ denied, code set |
| 4 | authorize | grant_id with mismatched amount | ✗ GRANT_MISMATCH |
| 5 | authorize_provision | 3 × 'M365 E3', unit_price × qty ≠ amount | ✗ AMOUNT_MISMATCH |
| 6 | authorize_provision | consistent totals under threshold | ✓ |
| 7 | authorize_tool | 'shell.exec' (sensitive) | ✗ TOOL_ESCALATION_REQUIRED |
| 8 | authorize_capability | 'plugin:browser' | per policy — assert code present |
| 9 | log_tokens | selected model, real-ish counts | ✓ logged; repeat to 402 budget |
| 10 | log_outcome | kind 'booking', dedupe_key twice | ✓ new, then ✓ deduped |
| 11 | request_execution | scope ['STRIPE_KEY'], $10, 300s | ✓ JWT returned |
| 12 | inject_credential | JWT from #11, in-scope label | ✓ value (dummy) |
| 13 | inject_credential | out-of-scope label | ✗ error |
| 14 | wallet_status | — | ✓ renders budgets + pending count |
| 15 | authorize + execution_jwt | spend > exec budget | ✗ EXEC_BUDGET_EXCEEDED |
| 16 | any, with bad API key | — | ✗ surfaced verbatim, NOT policy denial |
| 17 | any, API_URL → dead port | — | ✗ SANCTION_UNREACHABLE (fail-closed) |

**Known-issue check (GTM.md §0):** on the *default* demo policy, `perTxnMax $50`
< `escalateOver $100` with per-txn checked first → scenario 2 may deny instead
of escalate. If so the UI just found the pre-launch bug the GTM memo flagged —
record it, fix defaults/ordering as its own commit, don't paper over in the UI.

## 4-hour plan

- **H1:** manifest from zod schemas; API route + stdio-child MCP client; provision
  demo wallet; scenario 1 green end-to-end.
- **H2:** ToolSelector + InputPanel + ResponseViewer; scenarios 1–8 runnable.
- **H3:** escalation loop (poll + owner approve inline); run-all with ✓/✗;
  scenarios 9–15.
- **H4:** transport B toggle, model selector, failure-mode rows 16–17, polish.
  Overflow → cut transport B first, model selector second; the loop and matrix
  are the demo.

## Explicitly out of scope Saturday

Hosted remote MCP endpoint (separate backlog arc); auth hardening beyond the dev
gate; any Dreamscapes-specific code (Sunday, per WEEKEND-ROADMAP §Dreamscapes —
frontier routing stays in the cloud gateway).
