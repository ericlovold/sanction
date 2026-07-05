# Traceability — requirements → code → proof

Sanction's pitch is that every security claim maps to enforcing code and a
regression test. This registry applies the
same standard to the codebase: every security/behavior claim we make has an ID, the
code that enforces it, and the test that fails if it regresses. If you can't point
to the proving test, the claim goes in **Gaps** — not in marketing.

**Maintenance rule:** a PR that touches an enforcing surface listed here must keep
its row true (update the row, or the tests, or both). New invariants get a new ID
here in the same PR that introduces them. IDs are stable — never reuse one.

**Test gating:** plain `tests/*.test.ts` run everywhere (`npm run check`).
`tests/*.db.test.ts` need real Postgres (`RUN_DB_TESTS=1 npm run test:db`); CI
provides a Postgres service so both gates run on every push/PR.

## Requirement registry

| ID | Claim | Enforced in | Proven by | Status |
|---|---|---|---|---|
| **ADR-0009** | All authorization flows through one decision engine: ordered rules, deny overrides, escalate before allow, short-circuit | `lib/evaluation.ts`, `lib/rules/{spend,tool,provision,credential}.ts`, `lib/decisions.ts` | `evaluation.test.ts`, `decisions.test.ts`, `authorize-ladder.test.ts`, `provision-ladder.test.ts` | ✅ |
| **ADR-0009 M3** | Any MCP tool invocation is authorized like spend (block/allow/escalate lists; empty allow-list = opt-in); escalations persist to the approval inbox and approval mints a one-use tool grant redeemed on retry | `app/api/v1/authorize/tool/route.ts`, `lib/toolDecisions.ts`, `lib/rules/tool.ts`, `lib/approvals.ts` (`createToolPendingApproval`), `lib/grants.ts` (`consumeToolGrant`) | `tool.test.ts` (rules), `dataplane.route.test.ts` (route: persistence, idempotent replay, grant redemption/mismatch/one-use), `e2e.db.test.ts` (full escalate→approve→redeem loop) | ✅ |
| **ADR-0009 M4** | Credential injection is a policy decision (clearance, scope, expiry through the engine) | `lib/credentialDecisions.ts`, `lib/rules/credential.ts`, `app/api/v1/credentials/inject/route.ts` | `credential.test.ts`, `credential-inject.route.test.ts` | ✅ |
| **SEC-1** | Credentials at rest are envelope-encrypted: per-wallet DEK wrapped by KMS (prod) or env master (dev), AAD-bound to `wallet:label` | `lib/credentialCrypto.ts`, `lib/kms.ts`, `WalletKey` model | `crypto.test.ts` (envelope/AAD), `keys-rotate.route.test.ts` (owner-only rotation, ARN never leaked) | ✅ Phase 1 + Phase 2 (rotation) |
| **SEC-3** | Tenant isolation is enforced by Postgres RLS, not just query discipline — cross-tenant reads/writes fail at the database | `lib/rls.ts` (`withTenant`), RLS policies in migrations | `rls.db.test.ts` (7 tests, real Postgres, non-superuser role) | ✅ |
| **SEC-5** | Execution JWTs are bound to the issuing wallet (`aud`) and agent; alg pinned to HS256 — no replay across wallets/agents, no alg confusion | `lib/jwt.ts` (issue/verify) | `crypto.test.ts` (aud/alg), `authorize.route.test.ts` (garbage → 401, foreign agent → 403) | ✅ |
| **SEC-6** | Agent keys rotate (old hash overwritten, new key shown once) and revoke (`active:false`); management plane fails closed without a valid `sk_` key | `app/api/v1/agents/rotate/route.ts`, `app/api/v1/agents/route.ts`, `lib/ownerAuth.ts` | `routes.test.ts` (rotate + auth-gate suites), `auth.test.ts` | ✅ |
| **SEC-13** | Responses carrying secrets (exec JWT, injected credential) set `Cache-Control: no-store` | `app/api/v1/exec/route.ts`, `app/api/v1/credentials/inject/route.ts` | `exec.route.test.ts`, `credential-inject.route.test.ts` | ✅ |
| **UX-1** | Every denial carries a stable machine-readable `code` + remediation hint so agents replan instead of retrying blind | `lib/decisions.ts` (`decisionCode`, `REMEDIATION`) | `decisions.test.ts`, code assertions across `authorize.route.test.ts` / `provision.route.test.ts` | ✅ |
| **UX-2** | An escalation no human resolves settles to the policy's terminal state after `escalationTimeoutMins` (default fail-closed deny) — agents never deadlock | `lib/approvals.ts` (`settleIfExpired`), `app/api/v1/authorize/[id]/route.ts` | `approvals.test.ts` | ✅ |
| **FUND-1** | `?simulate=true` runs the full decision without persisting anything (policy dry-run) | `app/api/v1/authorize/route.ts`, `app/api/v1/authorize/provision/route.ts` | `authorize.route.test.ts`, `provision.route.test.ts` (decision returned, zero writes) | ✅ |
| **AUTHZ-LOCK** | Daily budgets are checked+debited under a per-agent advisory lock — concurrent calls can't both pass and overshoot | `/authorize`, `/authorize/provision`, `/tokens` (`pg_advisory_xact_lock`) | `concurrency.db.test.ts` (real Postgres race) | ✅ |
| **AUTHZ-IDEM** | An `Idempotency-Key` replay returns the original decision — a retry can never double-spend | `(agentId, idempotencyKey)` unique + replay branch in both authorize routes | `authorize.route.test.ts`, `provision.route.test.ts`, unique-violation catch | ✅ |
| **AUTHZ-JTI** | The exec JWT's `jti` **is** the ExecutionToken row id — issue and inject can never disagree (the P0 this guards against) | `lib/jwt.ts` (`issueExecutionJWT` returns `{jwt, jti}`), `/exec`, `/credentials/inject` | `exec.route.test.ts` (row id === jti), `e2e.db.test.ts` (store→exec→inject→revoke round-trip), `crypto.test.ts` | ✅ |
| **CASCADE** | Opt-in subtree daily caps are enforced atomically across the wallet tree; sibling agents can't race past a parent cap | `lib/cascadeBudget.ts`, `WalletBudgetCounter` | `cascadeBudget.test.ts`, `accountTree.test.ts`, `concurrency.db.test.ts` | ✅ |
| **GRANTS** | A human approval issues a single-use grant; consumption is atomic, re-consumption refused, expiry honored | `lib/grants.ts`, `lib/approvals.ts` | `grant-consumption.test.ts`, `approval-grants.test.ts`, route grant paths in `*.route.test.ts` | ✅ |
| **POOLS / ALERTS** | Budget pools allocate the cascade; threshold crossings notify before the wall ("no surprises") | `lib/budgetPools.ts`, `lib/budgetAllocation.ts`, `lib/thresholds.ts`, `lib/burn.ts` | `budgetPools.test.ts`, `budgetAllocation.test.ts`, `poolAccess.test.ts`, `poolForms.test.ts`, `burn.test.ts` | ✅ |
| **WEBHOOK-SIG** | Every machine webhook delivery is HMAC-SHA256 signed over the exact body; Slack incoming-webhook URLs are the one deliberate exception (Slack's URL is its own secret) and receive Block Kit instead of raw JSON | `lib/webhooks.ts` (`signBody`, `isSlackWebhookUrl`, `slackPayload`) | `webhooks.test.ts`, `delivery.test.ts` (Slack gets blocks + no signature; machine consumers keep signed raw JSON) | ✅ |
| **WEBHOOK-SSRF** | Registered webhook URLs must be public https — loopback/RFC1918/link-local-metadata/`.local`/`.internal` rejected | `lib/webhooks.ts` (`isPublicHttpsUrl`) | `webhooks.test.ts` (12 rejection cases + no-over-block) | ✅ |
| **RATE** | Unauthenticated endpoints are rate-limited per IP (fixed window) | `lib/rateLimit.ts`, `RateLimit` model | `rateLimit.test.ts` | ✅ |
| **GATEWAY** | Gateway meters provider usage (Chat Completions + Responses API, incl. SSE) and enforces budgets with `no-store` | `lib/gateway.ts`, `app/api/gateway/**` | `gateway.test.ts` | ✅ |
| **AUDIT-PLANE** | The unified feed (`/v1/audit-events`) and daily rollup (`/v1/reporting/daily-summary`) are membership-gated, time-sorted/cursor-paginated, and `no-store` | `app/api/v1/audit-events/route.ts`, `app/api/v1/reporting/daily-summary/route.ts`, `lib/reporting.ts` | `reporting.test.ts` (merge/sort/day-range math), `reporting.route.test.ts` (auth matrix, filters, cursor, rollup shape) | ✅ |
| **SEATS-1** | A seat (Agent) can be handed around safely: past `expiresAt` the key fails closed on BOTH auth planes (data plane and gateway); rotation moves the holder while history/config stay; batch creation stamps one template across ≤50 seats with each key shown once | `prisma/schema.prisma` (Agent.holder/expiresAt), `lib/auth.ts`, gateway `authAgent`, `app/api/v1/agents/{route,rotate,batch}` | `seats.route.test.ts` (expiry on both planes, rotate-with-holder, batch template incl. cents conversion + distinct keys), `e2e.db.test.ts` (real Postgres: batch keys authorize, expired key 401s, rotate hands the seat over), `sdk/src/sdk.test.ts` (SDK wire mapping for seats) | ✅ slice 1 (API + SDK + dashboard) · inheritance semantics + per-provider caps await customer demand |
| **STATS-AUTH** | Wallet stats/policy are membership-gated — knowing a `wallet_id` alone reads nothing | `app/api/v1/wallets/stats`, `app/api/v1/wallets/policy`, `lib/ownerAuth.ts` | `dataplane.route.test.ts` (401 matrix incl. foreign-wallet agent key) | ✅ |
| **AUTHZEN-PDP** | Sanction answers the OpenID AuthZEN 1.0 PEP↔PDP wire (`/access/v1/evaluation` + `/evaluations`) through the SAME decision ladders as `/v1/authorize*`; fresh evaluations are decision-only (never persist, debit, or open approvals); a deny is HTTP 200 `decision:false`; subject binds to the authenticated agent (mismatch fails closed); batch honors all three `evaluations_semantic` modes | `lib/authzen.ts`, `app/api/access/v1/{evaluation,evaluations}/route.ts` | `authzen.route.test.ts` (wire contract incl. X-Request-ID echo, no-persist assertion, subject binding, tool/spend/provision mapping vs live budget state, subtree cap, batch semantics + defaults merge + index-named 400s) | ✅ |
| **EVID-1** | Decisions are replayable evidence: every policy mutation writes an immutable `PolicyRevision` (all mutations flow through `upsertPolicyWithRevision`); decisions persist the revision in force plus the exact engine context evaluated; `GET /v1/authorize/{id}/evidence` re-runs the pure ladder over the stored context and reports whether it reproduces the outcome (determinism principle, DOMAIN.md) | `lib/policy.ts` (`upsertPolicyWithRevision`), `lib/evidence.ts`, `prisma` (PolicyRevision + decision columns, backfill migration), all three authorize routes, `app/api/v1/authorize/[id]/evidence/route.ts` | `evidence.route.test.ts` (determinism, tampered-record detection, endpoint auth matrix + shapes), `policy.test.ts` (revision written on every mutation, snapshot excludes mutable envelope), `pool-actions.test.ts` (pools writes bump revisions) | ✅ slice 1 · hash-chained exports remain Later |
| **UX-3** | Every denial answers four questions: what happened (`code`), why (`reason` + `limit{}` with the fired rule's values from the decision's own stored evidence; `resets_at` is intentionally clock-based), what changes the answer (`resets_at`, or a signed `access_request` appeal offer on hard budget denials, both wires), where is the evidence (`links.record`/`links.evidence`) | `lib/evidence.ts` (`limitFromDecision`, `APPEALABLE_DENIALS`), both authorize routes (`withAppeal`), `lib/authzen.ts` (`settleSpendDecision` offers on appealable codes) | `richDenials.route.test.ts` (four-questions assertions per denial band, AuthZEN offer, appeal round-trip denial→access-request→approval) | ✅ spend/provision · subtree-cap values + tool links deferred |
| **CAP-1** | Acquiring capability (skills, plugins, APIs, installs) is a governed action: one ordered rule list (`Policy.capabilityRules`, namespaced prefix-glob patterns) with block → allow-list → escalate precedence (an escalate pattern satisfies the allow-list); allowed/denied are decision-only, escalations persist to the same inbox with evidence, approval mints a one-use capability grant redeemed with `grant_id`; AuthZEN `resource.type: capability` rides the same ladder with AARP offers on escalation | `lib/capability.ts`, `app/api/v1/authorize/capability/route.ts`, `lib/policy.ts` (`capability_rules` input), `lib/grants.ts` (`consumeCapabilityGrant`), `lib/approvals.ts` (`createCapabilityPendingApproval`), `lib/authzen.ts` | `capability.route.test.ts` (ladder semantics incl. precedence + glob matching + malformed-entry parsing, route lifecycle: decision-only deny, escalation persistence w/ evidence, grant redeem + one-use refusal, AuthZEN permit/deny/escalate-with-offer) | ✅ slice 1 · dashboard rule editor deferred |
| **REPORT-1** | Reporting spans periods and projects forward: `/v1/reporting/summary` (any range ≤92 days, day buckets, per-agent grouping, membership-gated), `/wallets/stats` carries budget + linear projection + exhaustion forecast for day and month (guards suppress early-day/early-month extrapolation), `/audit-events?format=csv` exports the feed spreadsheet-ready with RFC 4180 quoting | `lib/reporting.ts` (`rangeUtc`, `toCsv`), `lib/burn.ts` (`monthlyPace`, strengthened morning guard), `app/api/v1/reporting/summary/route.ts`, stats + audit-events routes | `reporting-summary.route.test.ts` (range validation, auth, buckets, grouping, projection fields, no-policy nulls, CSV shape + escaping, pace guards) | ✅ slice 1 · digests shipped as REPORT-2 |
| **REPORT-2** | The week reports itself: Vercel Cron (Mon 14:00 UTC) pushes each opted-in wallet a 7-completed-days rollup — spend, token cost, decision counts, secret accesses, week-over-week deltas, busiest agent — through the existing webhook fan-out, so Slack routes get the formatted card and machine routes the signed JSON; `report.weekly_digest` is opt-in (never in the default event set, honored for `"*"` routes per that contract); the cron endpoint authenticates the `CRON_SECRET` bearer with a constant-time compare and fails closed when the secret is unset; one wallet's failure never starves the rest | `vercel.json` (schedule), `app/api/cron/digests/route.ts`, `lib/webhooks.ts` (event catalog + Slack case), `components/webhook-settings.tsx` | `digests.route.test.ts` (auth matrix incl. unset-secret fail-closed, rollup shape + wk/wk + 7-day window math, wallet dedupe + per-wallet failure isolation, zero-activity digest), `delivery.test.ts` (Slack digest formatting incl. flat-week no-delta) | ✅ |
| **AUTHZEN-AARP** | The escalate→approve→grant loop rides the draft AuthZEN Access Request and Approval Profile: escalate outcomes carry a signed `binding_token` (HS256, wallet-audience, agent-subject, 15-min TTL); `POST /access/v1/access-request` only persists an escalation when the token verifies AND signs the exact submitted subject/action/resource (tampered/mismatched → 400 problem+json, expired → 410); task status maps to the profile's states; re-evaluation with `context.approval` redeems the one-use grant atomically (the surface's single deliberate write) — replay denies `approval_expired` | `lib/authzen.ts` (binding token sign/verify, `canonicalSarc`, `redeemApproval`), `app/api/access/v1/access-request/{route,[id]/route}.ts`, `app/.well-known/authzen-configuration/route.ts` | `authzen-aarp.route.test.ts` (offer on escalate, happy-path open→persist, tampered/mismatched/expired token rejections, wallet-scoped task reads, status mapping incl. grant artifact, redemption consume + replay + mismatch) | ✅ loop · callbacks/catalogs/forms deferred while draft 1 stabilizes |

## SECURITY.md crosswalk

Every section of [`docs/SECURITY.md`](./SECURITY.md) maps to registry rows:
*Authentication planes* → SEC-6, STATS-AUTH · *Credentials at rest* → SEC-1 ·
*Execution tokens* → SEC-5, SEC-13, AUTHZ-JTI · *Decision engine* → ADR-0009,
AUTHZ-LOCK, AUTHZ-IDEM, UX-1 · *Webhooks* → WEBHOOK-SIG, WEBHOOK-SSRF ·
*Abuse controls* → RATE, SEC-3.

## Gaps (known, honest)

1. **Dashboard pages are untested** (server components; excluded from coverage
   focus). Data comes from the same tested libs; rendering regressions are caught
   manually today.

## Test-suite map

| Suite | Proves | Gate |
|---|---|---|
| `evaluation` / `decisions` / `*-ladder` / `tool` / `credential` | The decision engine and every rule family, as pure functions | unit |
| `authorize.route` / `provision.route` / `dataplane.route` / `exec.route` / `reporting.route` / `gateway.route` / `agents.route` / `keys-rotate.route` / `mgmt-routes` / `admin-misc.route` / `routes` / `credential-inject.route` | Route handlers: auth gates fail closed, validation, codes, persistence shape (mocked DB) | unit |
| `approvals-resolution` / `delivery` | Approval→grant resolution machinery; the best-effort delivery layer (thresholds, webhook fan-out, email, RLS wrapper, rate limiter) | unit |
| `golden-policy.server` / `golden-policy.sdk` | Golden policy fixtures: server and SDK decide identically on the same policy | unit |
| `auth` / `crypto` / `webhooks` / `rateLimit` | Security primitives: key hashing, owner auth, JWT binding, envelope crypto, HMAC, SSRF guard, rate limit | unit |
| `cascadeBudget` / `accountTree` / `budget*` / `pool*` / `burn` / `approvals` / `grants*` | Budget math, tree rollups, pools, thresholds, approval/grant lifecycle | unit |
| `gateway` | Provider metering + budget enforcement | unit |
| `e2e.db` | The full customer lifecycle against real Postgres (wallet→agent→authorize→vault→exec→inject→revoke→approve, incl. provision) | DB |
| `concurrency.db` | Advisory-lock atomicity under real concurrent transactions | DB |
| `rls.db` | RLS actually blocks cross-tenant access at the database, as a non-superuser | DB |

## Coverage ratchet

`vitest.config.ts` holds floor thresholds set just under current coverage —
they only move **up**. Raising them is part of landing any test-adding PR.
Current gate: **80/80 statements/lines, 80 branches, 85 functions** (actuals
~80.8/80.8/86.7 at the time the gate was set). Static page-content modules
(changelog, roadmap, docs, integrations, auth-client stub) are excluded from
measurement — they hold prose and SVG paths, not decisions.
