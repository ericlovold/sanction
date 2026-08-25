# Fable — Sanction fresh-eyes handoff

Verified **2026-08-25T18:04:13Z**. Re-check before acting: this document describes a moving system.

## Sprint fence

Fable is receiving Sanction's current product, roadmap, and delivery state, with the SDK/MCP release handoff made explicit.

Do not treat this as authorization to publish packages, choose a release version, install Slack for a wallet, change production secrets, or repair unrelated CI warnings. Claude owns the next SDK/MCP delivery work; Eric owns release/version and customer-install decisions.

## Ground state

- **Default branch:** `main` at `2d522bf1cf03201bb11312511538f542ac8e8c76` (`docs(slack): mark live approval surface (#262)`). There were no open PRs when checked with `gh pr list --state open`.
- **Local gate:** `npm run check` passed: 121 test files / 1,191 tests; 3 DB files / 20 tests skipped. TypeScript and lint had no errors; lint emitted 17 existing warnings.
- **Production:** the Vercel status for that commit is successful. `https://getsanction.com/`, `/slack`, and `/api/openapi.json` returned `200`; `/api/slack/oauth/start` returned `307` to login with `Cache-Control: no-store`; `/mcp` returned `401` without an agent key. These were checked with `curl` in this run.
- **Published artifacts:** `sanction-sdk@0.8.0` and `sanction-mcp@0.8.0` are both npm `latest`. Root, SDK, MCP manifest, MCP registry metadata, and `lib/mcpServer.ts` also say `0.8.0`; the newest git tag is `v0.8.0`.

Verification commands: `git fetch origin`; `gh pr list --state open`; `npm run check`; `curl -sS -o /dev/null -w '%{http_code}' https://getsanction.com/<route>`; `npm view sanction-sdk version dist-tags --json`; `npm view sanction-mcp version dist-tags --json`; `gh run view <current-main-ci-run> --log-failed`; and `gh api repos/ericlovold/sanction/commits/<main-sha>/status`.

## What just landed

Sanction is the authorization layer in front of autonomous-agent spend, tools, and credentials: approve, escalate, or deny; record the decision; mint a one-use grant on approval.

- **Slack is live:** `/slack` is the public install surface. An admin starts wallet-bound OAuth, selects the workspace/channel, and receives interactive Approve/Deny cards. The bot token is SEC-1-encrypted under the wallet; Slack signatures plus installed workspace/channel are checked before the shared `resolveApproval` path runs.
- **MCP broker:** `/mcp/broker/<upstream>` intercepts `tools/call` before forwarding to a registered upstream. The upstream credential is vaulted; direct upstream traffic remains outside this guarantee.
- **x402 gate:** `/v1/authorize/quote` prices supported USD-pegged payment challenges before a wallet signs. A broker withholds a refused challenge rather than returning payment requirements.
- **Distribution already shipping:** hosted MCP, REST, the TypeScript SDK, Slack, and Bedrock share the same policy/decision model. The Python LiteLLM logger is in-repo but not on PyPI.

## Roadmap and delivery

The public roadmap (`lib/roadmap.ts`) is accurate at the high level:

- **Now:** agent wallet/MCP, broker interception, conditional and inherited tool policy, observe mode, roster/team controls, Slack approvals, Local, and tamper-evident exports.
- **Next:** per-agent Wallet Cards, decision receipts, Python publication and LangChain/LangGraph/CrewAI adapters, plus pooled/subtree sequential simulation.
- **Later:** audit-chain anchors, customer-managed keys/SOC 2, and x402 settlement receipts plus a veto-only provider co-signer.

Delivery has one material exception: local verification is green, but GitHub **CI is red on main**. The failing final step runs `npm run build:mcp` and finds this generated-bundle drift:

```text
packages/sanction-mcp/mcp-server.js: MCP_SERVER_VERSION 0.7.0 → 0.8.0
```

The source and package metadata already say `0.8.0`; the checked-in bundled artifact does not. This is the first concrete action for Claude's release work. It is not evidence that Slack or the npm packages failed to deploy.

## Claude's SDK/MCP delivery handoff

1. Start from current `main`. Run `npm run build:mcp`; commit the generated bundle change that makes CI reproducible.
2. Run the release gates: `npm run check`, `npm --prefix sdk run typecheck`, `npm --prefix sdk run build`, `npx vitest run sdk/src`, and package dry-runs for SDK and MCP.
3. Ask Eric to choose the release version. Then synchronize every release literal, including the root app, SDK, MCP manifest, MCP registry metadata, and `lib/mcpServer.ts`; regenerate the MCP bundle after the version change.
4. After merge/tag, dispatch the active **Publish SDK** and **Publish MCP** workflows. The MCP workflow also publishes the official MCP registry entry.
5. Verify npm `latest`, then clean-install/import the SDK and run `npx sanction-mcp` from a temporary directory. Do not claim the release is live before both checks pass.

## Landmines

- **CI looks nearly green, then fails at the end.** Tell: all tests and coverage pass, but `build:mcp` ends with a one-line version diff. Cause: generated `packages/sanction-mcp/mcp-server.js` was not regenerated after the `0.8.0` source bump.
- **RLS can look like missing data.** Tell: a credential-vault or Slack-install query returns no rows even when the row exists. Cause: RLS-protected reads need `withTenant(walletId, fn)`, which sets the transaction-local wallet GUC; both `CredentialVault` and `SlackInstall` are protected.
- **A fresh clone can look dependency-broken.** Tell: imports from `lib/generated/prisma` fail. Cause: the Prisma client is gitignored; run `npx prisma generate` after install or schema changes.
- **A preview must not migrate production.** Tell: a build seems harmless but is pointed at the production data URL. Cause: preview deployments inherit it. `scripts/migrate-deploy.mjs` must stay production-only on Vercel or explicit `RUN_MIGRATE_DEPLOY=1` locally/CI.

## Owner decisions

- Eric chooses the next version and authorizes package publication; do not infer it from the feature list.
- Eric or a wallet admin chooses the Slack workspace/channel and completes the first real OAuth install; do not create a wallet-bound install speculatively.
- Production secrets and any Marketplace/listing work remain outside this handoff.

## Commands that worked

```bash
npm ci
npx prisma generate
npm run check

# Release-only: this currently exposes the stale generated MCP bundle.
npm run build:mcp
git diff -- packages/sanction-mcp/mcp-server.js

npm --prefix sdk run typecheck
npm --prefix sdk run build
npx vitest run sdk/src
```

## Fresh Eyes ledger

1. `main` at `2d522bf`, no open PRs, local gate 1,191 passing → **VERIFIED**
2. Production `/`, `/slack`, OpenAPI, and configured Slack OAuth redirect → **VERIFIED**
3. npm SDK/MCP and repo release literals at `0.8.0` → **VERIFIED**
4. CI fails only after generated MCP bundle drift appears → **LANDMINE**
5. Tenant-scoped vault/Slack reads can look empty without `withTenant` → **LANDMINE**
6. Prisma code generation after a fresh clone is required but easy to assume → **ASSUMED**
7. Next version, publishing, and first Slack install require Eric's decision → **DECIDE**
