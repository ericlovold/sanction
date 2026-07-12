// Build-in-public changelog. Add a new entry to the TOP of the array to publish.
// `body` is markdown (rendered with the shared <Markdown> component). Keep dates
// ISO (YYYY-MM-DD). `version` is optional — use it when a release is tagged.
//
// NOTE: seed dates/versions below are approximate — adjust to your actual release
// dates as you go. New entries on top.

export type ChangelogEntry = {
  date: string
  title: string
  version?: string
  tags?: string[]
  body: string
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-07-10",
    title: "The web now charges your agents. Sanction decides what they pay.",
    tags: ["adapters", "x402", "pay-per-crawl", "spend"],
    body: "Cloudflare flipped the switch: any site, dataset, API, or MCP tool behind them can now charge agents per request — a `402` with a `crawler-price` quote, settled over x402, with agent crawlers blocked by default on ad pages from September 15. The protocol's own answer to \"what will my fleet pay?\" is a static max-price header. A cap is not governance. The SDK's new `sanctionedFetch` wraps your crawler's fetch (your Web Bot Auth signing stays yours): a paid page's quote runs through `/authorize` as a real spend decision — merchant = the site, category = content-access — so auto-approve bands, per-domain audit, daily and pooled department budgets, human escalation on unusual prices, and one-call freeze all apply before a cent of payment intent leaves your stack. Approved quotes retry echoing the site's own price verbatim; anything else is a typed planning outcome carrying the request id. Every payment lands in the audit feed tagged `pay-per-crawl` with the URL, so finance can answer \"what did we pay the web last month, by department?\" — the question this era just invented. [Guide](/docs/pay-per-crawl).",
  },
  {
    date: "2026-07-10",
    title: "@sanction/sdk — publish-ready, escalate loop closed",
    tags: ["sdk", "adapters", "release"],
    body: "The TypeScript SDK is ready for npm as **`@sanction/sdk@0.6.0`** (FSL-1.1-MIT, same terms as the server source). Package metadata, LICENSE, build/`prepublishOnly`, and a manual `publish-sdk` workflow mirror the MCP publish path. The escalate→grant loop is complete in the client: `getAuthorization(requestId)` polls an escalated decision for its one-use `grantId`, and `sanctionTool` accepts `grantId` on retry. `npm install @sanction/sdk` once the workflow has run against the `sanction` npm org. Python adapters stay Next.",
  },
  {
    date: "2026-07-10",
    title: "Sanction Local's install package — no-egress pack + assessor download",
    tags: ["local", "packs", "audit"],
    body: "The Local roadmap item was \"runtime to install.\" The install half lands here. A new **`no-egress`** policy pack (`channel: local`) allows only exact on-box tools — `local.ollama`, `local.chroma`, `local.embeddings`, `local.memory` — blocks named cloud egress tools, and escalates or blocks new capability. Every deny still persists as an audit row (the no-egress evidence shape). On the console, the Audit page gains **Signed evidence (JSON)**: the same tamper-evident AUDIT-1 document as `GET /v1/audit/export`, cookie-authed so an operator downloads it for the assessor without curling an `sk_` key. Preview the pack against your last 30 days before applying; verify any export with `POST /v1/audit/verify`. Sanction decides and evidences — the runtime must still refuse egress.",
  },
  {
    date: "2026-07-10",
    title: "v0.6.0 — drop-in governance, provable history",
    version: "0.6.0",
    tags: ["release", "sdk", "audit", "authzen", "console"],
    body: "One day after v0.5.0 closed the surface-parity gap, v0.6.0 ships the two things a governance layer must do to be adopted and to be believed: **drop in without a rewrite**, and **prove its own record**. The SDK's framework adapters put the decision in front of execution — `authorizeTool`, `SanctionMiddleware`, and native Vercel AI SDK tool binding — so the model plans freely but the tool runs behind an approve. The decision history now exports as a **signed, hash-chained document** any auditor verifies self-contained, and the what-if simulator replays your real week **in order**, an early denial freeing budget downstream. Around the core: the AuthZEN PDP hardened (single-use denial tokens, no grant burn in batches, no approval dead loops, per-agent rate limits), capability governance reached the MCP runtime (`sanction_authorize_capability`, sanction-mcp 0.5.0), the org owner's console now sees the whole wallet tree, and the storefront finally names the internal-governance buyer it was built for. Full detail in the entries below.",
  },
  {
    date: "2026-07-10",
    title: "Capabilities ask first from any MCP host — sanction-mcp 0.5.0",
    tags: ["mcp", "capability", "release"],
    body: "Capability governance (CAP-1) reached the runtime where agents actually live. The new `sanction_authorize_capability` MCP tool asks before an agent installs a skill, adds a plugin, or reaches a new API — the same ordered rule ladder, approval inbox, and one-use grants as the REST surface, now from any MCP host. `npx sanction-mcp`; ten tools total.",
  },
  {
    date: "2026-07-10",
    title: "The org owner sees the whole org",
    tags: ["console", "governance", "pools"],
    body: "Budgets already cascaded through the wallet tree; now visibility does too. The **Audit page** reads your entire subtree — every department pool's decisions, token burn, and secret access in one trail, each row carrying its pool name, the per-agent rollup spanning the org. The **Approvals inbox** gains *Waiting in your pools*: escalations pending in the wallets below yours, visible the moment they stall — read-only by design, because each pool's owner decides in their own inbox; the org owner's job is knowing they're waiting, not deciding over their head. A leaf wallet sees exactly what it saw before. This is the internal-governance shape made whole: the CFO who set the department budgets can now watch the same tree enforce them.",
  },
  {
    date: "2026-07-09",
    title: "The PDP grows armor — AuthZEN hardening sprint 2",
    tags: ["authzen", "security", "hardening"],
    body: "Five deeper findings from the AuthZEN code review, closed. **Binding tokens are now single-use**: every requestable denial carries a jti that's consumed atomically with the escalation it opens — replay the same denial under a fresh idempotency key and you get a problem+json refusal, not a second approval (honest retries still replay safely; they're checked first). **Batch requests pre-validate every item** before anything evaluates, so a malformed sibling can no longer burn a grant redemption into a 400 it didn't cause. **Timeout-approvals mint a real grant** (`issuedBy: policy_timeout`) — an AARP poller now receives something redeemable instead of an approved-with-nothing dead loop. **All four AuthZEN endpoints rate-limit per agent** with `Retry-After` (the 50-item batch amplifies, so it gets the tighter window). And an explicit empty batch returns empty, not a surprise default-tuple evaluation. Fourteen new tests pin it all.",
  },
  {
    date: "2026-07-09",
    title: "What-if, replayed in order",
    tags: ["simulation", "policy", "evidence"],
    body: "The retro-simulation could already tell you which of last week's decisions a candidate policy would flip — but it held budget counters constant, so it couldn't model the knock-on: a policy that denies an early charge *frees that budget* for the request that came after. Now it can. `POST /v1/policy/simulate` takes `mode: \"sequential\"` — it replays the window in chronological order, threading each agent's approved spend forward (daily and monthly counters reset at the UTC boundaries), so a would-denial no longer counts against the requests that follow it. The default stays `as_recorded` (each decision replays with the budget it actually saw); `sequential` shows the week as it *would have lived* under the new policy. Same read-only honesty envelope — nothing persisted, debited, or escalated — and the response says which mode ran and that subtree/pool caps aren't threaded yet.",
  },
  {
    date: "2026-07-09",
    title: "The tool runs behind the decision — framework adapters land in the SDK",
    tags: ["sdk", "adapters", "integrations"],
    body: "The TypeScript SDK (in-repo; publishing is next) grew the adapter layer that puts Sanction's tool gate *in front of* execution instead of beside it in a log. `authorizeTool` wraps any \"run this tool\" thunk: approved → run; escalated → wait for the one-use grant; denied → `SanctionToolBlocked` with the machine code and request id, so a denial is a normal planning outcome, not a crash. `SanctionMiddleware` does the same as a wrap-everything layer, and `sanctionTool` binds it natively to Vercel AI SDK tools — the model can *plan* whatever it likes, but the tool only executes behind an approve. The adapters are framework-agnostic on purpose (they take a client and a thunk); LangChain, CrewAI, and LiteLLM bindings ride the same core next, recipes already in the [adapter guide](/docs/framework-adapters).",
  },
  {
    date: "2026-07-09",
    title: "v0.5.0 — one engine, every surface: AuthZEN + MCP reach parity",
    version: "0.5.0",
    tags: ["authzen", "mcp", "governance", "release"],
    body: "The guarantee Sanction sells — same request, same policy, same state, same decision — now holds *across surfaces*, not just on `/authorize`. The AuthZEN PDP and the MCP tools were built earlier and had quietly fallen behind the native path as new controls landed; this release closes the gap. A **frozen wallet** now denies on the AuthZEN evaluation *and* on grant redemption, exactly as every native route does — no spending through the one-control stop. **Cost-per-outcome ceilings** are enforced on the PDP too, so a spec-conformant enforcement point can't keep buying through a throttled channel. **Token budgets** — the seat's monthly line and the pooled per-department daily cap, not just the daily — are enforced when usage is logged via `/tokens` or MCP, closing a path that drained caps it didn't check. On the MCP side, escalations are no longer a dead end: a new `sanction_check_authorization` tool polls a pending approval for its one-use grant, and config or freeze failures surface their real cause instead of a generic denial. Access-request submissions now require an idempotency key so one approval can't be replayed into many. A cross-surface parity test suite pins it all so the surfaces can't drift again.",
  },
  {
    date: "2026-07-07",
    title: "sanction-mcp 0.4.0 — outcomes from any MCP host",
    version: "0.4.0",
    tags: ["mcp", "outcomes", "release"],
    body: "The MCP server learned to report results, not just ask permission. `sanction_log_outcome` records a confirmed business outcome — an enrollment, a booking, a signed engagement — from whatever MCP host your agent runs in, with `dedupe_key` idempotency so a retried tool call never double-counts. That closes the loop for cost-per-outcome governance without a single custom integration: the same agent that asks `sanction_authorize` before spending now attests what the spend produced. `npx sanction-mcp` as always; eight tools total.",
  },
  {
    date: "2026-07-07",
    title: "Spend answers to outcomes — ceilings, freeze, reallocation",
    tags: ["outcomes", "governance", "freeze", "budgets"],
    body: "A budget says what an agent *may* spend. An outcome says what the spend *was for*. Now Sanction governs on the ratio. Your systems attest results (`POST /v1/outcomes` — an enrollment, a booking; idempotent via `dedupe_key`, Sanction never invents them), and a wallet with a `cost_per_outcome` ceiling **escalates every further charge** once its windowed cost-per-outcome would cross the line — never denies, the channel just stops spending silently and starts asking a human. A cold-start guard keeps small samples ungoverned until there's enough signal. Around it, the two controls a CFO actually reaches for: **wallet freeze** — one call pauses a wallet and its entire subtree across every surface (spend, tools, provisioning, credentials, the gateway), deleting nothing, and unfreeze resumes where the fleet stopped — and **budget reallocation**, which moves cap between sibling pools atomically, refuses to overdraw, and leaves a revision trail plus an audit row. The dashboard's new **Outcomes** page reads it all back: cost per outcome per pool against its ceiling, with the engine's own status semantics — frozen, cold start, throttled, or earning its cost.",
  },
  {
    date: "2026-07-06",
    title: "Sanction Local's runtime went air-gapped",
    tags: ["local", "airgap", "audit"],
    body: "The reference client ([AIIA](https://github.com/ericlovo/AIIA), the agent runtime we dogfood Sanction with) now has a real air-gap mode: one flag (`AIIA_AIRGAP=1`) and inference, embeddings, retrieval, and memory all stay on the box. Every cloud egress point — LLM providers, transcription, notifications, TTS, web fetch — is denied **fail-closed**, and each denied attempt is reported to Sanction, where it persists as an audit row. That's the Sanction Local claim made mechanical: *data never leaves the building* isn't a promise, it's a deny-list plus an export your assessor can read. The runbook ships with it — probe script, health readout of every governed egress point, and the network-watch commands to verify silence on the wire yourself.",
  },
  {
    date: "2026-07-06",
    title: "Denials are now evidence",
    tags: ["audit", "authorization", "evidence"],
    body: "A denied tool authorization used to be decision-only — correct, deterministic, and gone. Now every deny on `/v1/authorize/tool` persists as an audit row carrying the policy revision it ran under and the exact context the engine evaluated, so it replays like every other decision. Allows stay decision-only (tools fire at high frequency; deterministic decisions replay for free) — but a deny is an anomaly, and on a no-egress policy it's the whole point: the row *is* the proof the attempt was stopped. Denied rows surface in the audit feed and the CSV export with everything else.",
  },
  {
    date: "2026-07-06",
    title: "Perplexity behind the gateway",
    tags: ["gateway", "providers", "metering"],
    body: "The LLM gateway now meters Perplexity. Point any OpenAI-compatible client at `/api/gateway/perplexity` with your `x-sanction-key` and every sonar call — search, reasoning, deep research — lands in the same token budget, spend caps, and audit trail as your Anthropic, OpenAI, and Gemini traffic. Streaming metered in-flight, fail-closed like the rest: if usage can't be metered, the response is withheld, not given away free.",
  },
  {
    date: "2026-07-06",
    title: "The console catches up to the API",
    tags: ["console", "onboarding", "auth"],
    body: "Everything the API could do that the console couldn't: closed. The full policy editor is on the dashboard — every field, packs with a one-click picker, and simulation preview inline so you see which of last month's calls would flip *before* you save. The audit & reporting page brings the decision feed and CSV export to the browser. Onboarding got a guidance layer with one-click MCP installs for Claude Code and Cursor. And Sign in with Apple joins Google and GitHub. You click what you used to curl.",
  },
  {
    date: "2026-07-05",
    title: "Policy packs — start from a policy that fits, with proof",
    tags: ["policy", "packs", "simulation"],
    body: "A blank policy form asks you to invent numbers. Packs start you from a position: **Metering first** (watch, don't block), **Startup defaults** (a ceiling, not a committee), **Team workspace** (departmental budgets, escalation where it matters), **Compliance baseline** (fail closed — everything asks). `GET /v1/policy/packs` lists them; one call applies one — through the same revision-writing path as every policy edit, so the evidentiary chain doesn't care whether you typed the numbers or picked a pack. And because simulation shipped first, every pack comes with proof instead of promises: `POST /v1/policy/packs/{id}/preview` replays your last 30 days under the pack and shows exactly which calls would have flipped — before you commit.",
  },
  {
    date: "2026-07-05",
    title: "The architecture, taught",
    tags: ["docs", "architecture"],
    body: "The docs taught integration before they taught the mental model. Fixed, in three surfaces. [How Sanction works](/architecture): the whole system in one diagram — identity stays upstream, every action passes through one atomic evaluation, three outcomes, execution wherever the agent runs. [Why Sanction](/why): the six claims underneath everything — identity isn't authorization, prompts aren't policy, observability isn't enforcement, approval is not execution, evidence requires replay, governance should travel with the agent. And a [Concepts library](/docs) — Authorization, Evidence & replay, Capability governance — so the model comes before the endpoints. Read those once and every API makes sense.",
  },
  {
    date: "2026-07-05",
    title: "What if? — test a policy against last week before you set it",
    tags: ["policy", "evidence", "simulation"],
    body: "Editing a budget used to be a guess: set $500, wait a week, see what breaks. Now you ask first. `POST /v1/policy/simulate` takes a candidate policy — any subset of the normal policy fields, in dollars — and replays your real decision history under it: *under a $500 daily budget, 14 of last week's 212 approvals would have been denied, $1,840 of spend would not have cleared, and these are the exact fourteen.* Every stored decision already carries the exact context the engine evaluated (that's the evidence layer), and the rules are pure, so the simulation is the same code path that made the original calls — not an estimate. The response is honest about its envelope: counters are held as recorded (an early simulated denial doesn't free up budget for a later request — yet), and anything it can't simulate is counted and named, never guessed.",
  },
  {
    date: "2026-07-05",
    title: "The Monday-morning digest",
    tags: ["reporting", "notifications"],
    body: "The week now reports itself. Subscribe a notification route to `report.weekly_digest` (one checkbox on the dashboard, or the `events` array on `POST /v1/webhooks`) and every Monday your Slack gets last week in one card: spend and token cost with week-over-week deltas, approved / denied / escalated counts, secret accesses, and the busiest agent. Machine endpoints get the same rollup as signed JSON. It's opt-in — nothing changes for existing routes unless they subscribed to everything — and a quiet week still reports: all zeros is information too.",
  },
  {
    date: "2026-07-05",
    title: "Reporting that looks both ways",
    tags: ["reporting", "projections", "budgets"],
    body: "Reporting used to answer one day at a time, looking backward. Now it spans periods and looks ahead. `GET /v1/reporting/summary` takes any range up to 92 days and returns totals, day-by-day buckets, and per-agent breakdowns — this week vs last week is two calls. `GET /v1/wallets/stats` now projects: today and this month each carry their budget, the linear pace projection, and an exhaustion forecast (\"at this pace, the month's budget runs out on the 23rd\"). The early-morning and early-month guards keep one 6 a.m. purchase from projecting nonsense. And `GET /v1/audit-events?format=csv` hands finance the whole feed, spreadsheet-ready. Scheduled digests — the Monday-morning summary in your Slack — are next.",
  },
  {
    date: "2026-07-05",
    title: "Capability governance — new powers ask first",
    tags: ["authorization", "capabilities", "skills"],
    body: "An agent that installs a skill, adds a plugin, or reaches a new API has changed what it can do. That change is now a governed action like spending money. One ordered rule list on the wallet policy, with namespaced patterns: block `skill:install:crypto-*`, escalate `skill:install:*`, allow `api:github.com/*`. `POST /v1/authorize/capability` answers allow, deny, or escalate; escalations land in the same approval inbox, approval mints the same one-use grant, and every escalation carries replayable evidence. The AuthZEN wire speaks it too: `resource.type: \"capability\"`, with the AARP appeal offer on escalations. Skills are how agents grow; now growing is governed.",
  },
  {
    date: "2026-07-04",
    title: "Denials that answer back",
    tags: ["authorization", "developer-experience", "evidence"],
    body: `A 403 is a dead end. A Sanction denial now answers the four questions an agent actually has:

- **What happened?** The machine code, as always: \`DAILY_BUDGET_EXCEEDED\`.
- **Why?** A \`limit\` block with the fired rule's live values: limit $200, used $184.20, remaining $15.80, you asked for $42.
- **What changes the answer?** \`resets_at\` tells you when the clock helps. And hard budget denials now carry the same signed \`access_request\` offer as escalations — on the native API and the AuthZEN wire both — so the agent can appeal to a human instead of waiting for midnight.
- **Where is the evidence?** \`links.record\` and \`links.evidence\` point at the decision and its replay.

The numbers come from the decision's own stored evidence, so an idempotent replay answers identically without re-reading budget state. An appealed denial lands in the same inbox as every escalation; approving mints the same one-use grant.`,
  },
  {
    date: "2026-07-04",
    title: "Decisions you can replay",
    tags: ["evidence", "policy", "audit"],
    body: `Audit tells you what happened. Evidence proves the engine decided correctly under the policy that existed then. Those are different problems, and today Sanction solves the second one:

- **Every policy edit is now an immutable revision.** Change a budget, a threshold, a tool list — the previous state is snapshotted forever, and the policy's revision number ticks up. There is no code path that mutates a policy without writing the record.
- **Every decision records what it saw.** The revision in force, and the exact context the engine evaluated — the amount, the budget state read under the lock, the lists, the thresholds.
- **\`GET /v1/authorize/{id}/evidence\`** returns all of it, plus a live replay: the same pure rules re-run over the stored context, right now, with a \`matches\` flag proving the record still reproduces the decision.

This is the determinism principle doing real work: same request, same policy revision, same state snapshot, same decision — so replay is one call to a pure function, not a reconstruction project. Existing policies were backfilled as revision 1; hash-chained exports stay on the roadmap as the next rung.`,
  },
  {
    date: "2026-07-04",
    title: "The approval loop speaks AuthZEN too — AARP, same day",
    tags: ["authorization", "standards", "authzen", "approvals"],
    body: `This morning Sanction learned to answer the AuthZEN evaluation wire. Tonight the part that makes Sanction *Sanction* — deny is easy, escalate is the product — rides the standard too, via the draft [Access Request and Approval Profile](https://openid.github.io/authzen/authzen-access-request-approval-profile-1_0.html):

- **Requestable denials.** A would-escalate evaluation now returns \`context.access_request\`: where to open the approval, and a signed \`binding_token\` proving the denial happened here.
- **\`POST /access/v1/access-request\`** turns that denial into a real escalation — the owner's inbox, email, Slack, webhooks, all of it. You get an AARP task handle back.
- **Poll the task**, and approval carries the profile's artifact: \`approval.id\` is the one-use grant, \`approved_until\` its expiry.
- **Redeem by re-evaluating** with \`context.approval\` — the grant is consumed atomically, one use, exactly the native semantics. A replay denies with \`aarp_reason: "approval_expired"\` and \`next_action: "request"\` so the agent replans instead of retrying forever.
- **\`GET /.well-known/authzen-configuration\`** advertises the endpoints and the access-request capability, so a PEP given only the hostname finds everything.

The profile is draft 1; we implemented the loop and skipped the periphery (callbacks — use notification routes; catalogs and form schemas) while it stabilizes. The loop itself has been in production here since before the profile named it.`,
  },
  {
    date: "2026-07-04",
    title: "Sanction speaks AuthZEN — a standards-native PDP",
    tags: ["authorization", "standards", "authzen"],
    body: `Sanction now answers the [OpenID AuthZEN Authorization API 1.0](https://openid.net/specs/authorization-api-1_0.html) — the approved standard for how an enforcement point asks a decision point "may this happen?". Any AuthZEN-capable gateway or framework can point at Sanction as its PDP with zero Sanction-specific code:

- **\`POST /access/v1/evaluation\`** — the standard subject/action/resource tuple in, \`{ "decision": true }\` out. \`resource.type\` selects the ladder: \`tool\` runs the block/allow/escalate lists, \`spend\` and \`provision\` run the dollar ladders against live budget state (daily, monthly, per-transaction, cascading subtree caps).
- **\`POST /access/v1/evaluations\`** — the batch form, with all three spec semantics: \`execute_all\`, \`deny_on_first_deny\`, \`permit_on_first_permit\`.
- **Denials explain themselves.** A deny is a spec-correct \`decision: false\`, and \`context\` carries Sanction's stable machine code and remediation — \`TOOL_BLOCKED\`, \`ESCALATION_REQUIRED\`, \`DAILY_BUDGET_EXCEEDED\` — so agents replan instead of guessing.
- **Decision-only, fail-closed.** Evaluation never debits a budget or opens an approval (the \`?simulate=true\` contract); a would-escalate answer tells the PEP exactly which Sanction endpoint opens the real approval and mints the one-use grant. The subject binds to the authenticated agent's key — asking about anyone else fails closed.

The AuthZEN access-request-and-approval profile (AARP) — the standards path for Sanction's escalate → approve → grant loop — is next.`,
  },
  {
    date: "2026-07-04",
    title: "Approvals that find you — Slack, natively",
    tags: ["approvals", "notifications", "slack"],
    body: `Paste a Slack incoming-webhook URL into notification routes and escalations arrive as readable messages, not raw JSON:

- **Approvals** land as "*tenet* needs approval for *$60.00* — Vendor" with a **Review in Sanction** button.
- **Budget warnings** read "*tenet* has used *84%* of its daily spend" — same 80% line as the dashboard meters and emails.
- **Resolutions and exhaustions** report themselves too. Machine consumers are untouched: non-Slack endpoints keep the HMAC-signed raw payload.

No Slack app to install, no OAuth — the incoming-webhook URL is the whole setup, and Sanction detects it automatically.`,
  },
  {
    date: "2026-07-03",
    title: "Seat wallets, slice 1 — seats you can hand around",
    tags: ["seats", "agents", "management"],
    body: `An agent is now a **seat**: a keyed identity with budgets you can hand to whoever holds it.

- **Contractor auto-shutoff** — set \`expires_at\` on any agent and its key fails closed past that instant, on the data plane and the LLM gateway both. No deactivation step to forget.
- **Holders** — every seat can carry the name of the human holding it, for the audit trail and the dashboard. Rotating a key accepts a new \`holder\` in the same motion: the person changes, the seat's history, budgets, and clearance stay.
- **Batch seats** — \`POST /v1/agents/batch\` stamps one template across up to 50 seats in one call: "five engineering seats, $20/day each, clearance 2, expiring end of quarter." Each key is shown once; only hashes are stored.

Slice 2 (seat-history semantics on reassignment, per-provider budgets within a seat) is being shaped with our design partner. Roadmap: seat wallets stays in **Now** until the full story ships.`,
  },
  {
    date: "2026-07-03",
    title: "Tool escalations reach the inbox — govern any action closes the loop",
    tags: ["authorization", "tools", "grants"],
    body: `Tool governance was decision-only: an escalated tool call answered \`escalated\` and then evaporated. Now it completes the same loop as spend and provision:

- **Escalations persist** — an escalated \`POST /v1/authorize/tool\` writes an audit row and lands in the owner's approval inbox alongside spend and provision requests, with webhook + email notification.
- **Approval mints a one-use tool grant** — redeem it by retrying the same tool (and server) with \`grant_id\`, or poll \`/v1/authorize/{id}\`. Consumption is atomic and one-use; a mismatched tool gets \`GRANT_MISMATCH\`, a replayed grant gets \`GRANT_ALREADY_USED\`.
- **Idempotency-Key on tool calls** — replaying the key returns the escalation's current state, including the terminal decision once the owner resolves it, so a re-POST doubles as a status check.
- **sanction-mcp** \`sanction_authorize_tool\` gains \`grant_id\`, and \`/api/openapi.json\` now documents the endpoint.

Proven end-to-end against real Postgres: escalate → inbox approval → grant minted → redeem on retry → second redemption refused. The full trace is in [docs/TRACEABILITY.md](https://github.com/ericlovold/sanction/blob/main/docs/TRACEABILITY.md).`,
  },
  {
    date: "2026-07-03",
    title: "The audit plane arrives — unified feed, daily summary, monthly caps, and a TypeScript SDK",
    tags: ["audit", "budgets", "sdk", "dashboard"],
    body: `Yesterday the authorization plane grew muscles; today it grew a memory and a voice:

- **Unified audit feed** — \`GET /v1/audit-events\` merges every spend decision, token log, and credential injection into one time-sorted feed with type filters and cursor pagination. The "what did my agents do?" endpoint.
- **Daily summary** — \`GET /v1/reporting/daily-summary\`: one call returns the day's spend, decision counts, token cost, secret accesses, and the five most expensive tasks. The screen you check before coffee.
- **Monthly spend caps** — policies can now set an opt-in \`monthly_spend_budget_usd\` alongside the daily cap, enforced atomically on **both** spend and provision (a provision is spend — no side doors). New \`MONTHLY_BUDGET_EXCEEDED\` decision code with a remediation hint.
- **@sanction/sdk** — a zero-dependency TypeScript SDK for both planes: \`SanctionClient\` (authorize, log tokens, scoped credential injection) and \`SanctionAdminClient\` (wallets, agents, policy). A \`denied\` decision is *returned, not thrown* — agents branch and replan.
- **Runnable starter kit** — \`examples/nightly-coding-agent\` demonstrates the whole governed-autonomy loop offline against a deterministic mock, plus copyable policy blueprints for coding and research agents.
- **Console shell** — the dashboard is now one console: a persistent sidebar with a live pending-approvals badge across Overview, Agents, Pools, Spend, Approvals, and Grants.
- **Red-team CI gate** — five adversarial guardrail probes (over-limit spend, blocked category, over-clearance credential, out-of-scope injection, exec-budget breach) now run on every push. The suite passing *is* the "5/5 guardrails held" scorecard.

Next on the [roadmap](/roadmap): Sanction Local, and a local-first SDK fallback for when the network isn't there.`,
  },
  {
    date: "2026-07-02",
    title: "Provision authorization, no-surprises alerts, DB-level tenant isolation — and sanction-mcp 0.3.0",
    version: "v0.3.0",
    tags: ["release", "security", "authorization"],
    body: `The biggest shipping day since going public — the authorization plane grew three new muscles:

- **Provision authorization** — govern resource provisioning as one native call: \`POST /v1/authorize/provision\` takes resource + line item + quantity + dollars, runs the same policy ladder and daily budget as spend, and adds resource allow/block/escalate lists. Escalations mint one-use grants; retry with the grant to proceed.
- **No-surprises budget alerts** — a new \`budget.threshold\` webhook + heads-up email fires exactly once when a charge crosses 80% of any daily budget or pool cap — *before* anything is denied. Dashboards now project the burn: "on pace for $86 today · cap hit ~4:12 PM."
- **Budget pools + allocation** — delegated pools across your account tree, with allocation strategies to rebalance a parent cap across child pools from the dashboard.
- **Postgres row-level security** — the credential vault and clearance tables are now tenant-isolated *at the database level*, fail-closed, on top of the KMS envelope encryption already at rest. A SQL bug can't read another tenant's rows; a DB dump can't be decrypted.
- **sanction-mcp 0.3.0** ([npm](https://www.npmjs.com/package/sanction-mcp)) — the MCP server catches up to all of it: a new \`sanction_authorize_provision\` tool, \`grant_id\` retries on authorize, and hardened transport (network failures now degrade to a clear deny, never an ambiguous error).

The [roadmap](/roadmap) moved with it: approval→grants, provision, pools, and threshold alerts are all *Now*; next up — Sanction Local and the agent-platform starter kit.`,
  },
  {
    date: "2026-07-01",
    title: "Human approvals now issue grants",
    tags: ["approvals", "wallets"],
    body: `Sanction's approval loop now has a durable authorization record:

- **Generic approvals** — spend escalations now land as \`PendingApproval\` rows that can also support tool and credential workflows.
- **Grants ledger** — owner approval issues a short-lived \`Grant\` with provenance: who approved it, what agent received it, what resource it covers, and why.
- **Opt-in subtree caps** — parent wallets can set \`subtree_daily_cap_usd\` to enforce a tree-wide daily spend cap across descendants. Leaving it null keeps subtree enforcement disabled while spend rollups remain visible.`,
  },
  {
    date: "2026-06-29",
    title: "v0.2.0 — framework guides, public roadmap, clearer positioning",
    version: "v0.2.0",
    tags: ["release"],
    body: `Our first feature release since going public:

- **Framework guides** — drop Sanction into your agent in minutes: [Quickstart](/docs/quickstart), [Vercel AI SDK](/docs/ai-sdk), [LangChain](/docs/langchain), [CrewAI](/docs/crewai).
- **Public roadmap + changelog + idea board** — [tell us what to build next](/roadmap) and vote on it.
- **Account tree** — govern many agents under one master account, with per-tenant budgets and subtree spend rollup.
- **Clearer positioning** — Sanction is the authorization layer for AI agents, with an honest integrations story.`,
  },
  {
    date: "2026-06-28",
    title: "Building Sanction in the open",
    tags: ["product"],
    body: `We're now shipping our roadmap and release notes in public. Every
product update lands here, and you can [tell us what to build next](/roadmap) —
submit ideas, vote, and watch them move from *under consideration* to *shipped*.

Subscribe below and we'll send updates as they ship. No spam.`,
  },
  {
    date: "2026-06-25",
    title: "Account tree — govern a fleet under one master account",
    tags: ["wallets", "platform"],
    body: `Wallets can now nest into an org → tenant → sub-tenant hierarchy.
Provision one agent per tenant, set per-tenant budgets, and roll spend up the
tree for chargeback — all from a single account.`,
  },
  {
    date: "2026-06-20",
    title: "Gateway metering across providers + escalation timeouts",
    tags: ["gateway", "policy"],
    body: `Route Anthropic, OpenAI, and Gemini through one gateway and one key —
every token metered and capped in one place. Plus: an escalated request that no
human resolves now settles to a fail-closed fallback, so a polling agent never
deadlocks.`,
  },
  {
    date: "2026-06-15",
    title: "Authenticated management plane + atomic spend",
    version: "Security gate · PR #1",
    tags: ["security"],
    body: `Closed a credential-disclosure path: the management plane now requires
an owner key on every call. Spend authorization is atomic and idempotent — a
retry can't double-spend, and two concurrent requests can't both slip past the
daily cap.`,
  },
]
