// Manifest of the sanction-mcp tool surface for the dev test UI.
//
// Mirrors the zod input schemas in mcp-server.ts (v0.7.0) as render-able field
// specs, plus the canned scenario matrix from docs/plans/mcp-test-ui.md. The UI
// must exercise the real MCP server — this file only describes its shape; if a
// tool is added or a schema changes in mcp-server.ts, update here and the drift
// test in tests/mcpToolManifest.test.ts will hold the two in sync by tool name.

export type FieldSpec = {
  key: string
  type: "string" | "number" | "integer" | "enum" | "json" | "string[]"
  required: boolean
  enum?: string[]
  placeholder?: string
  help: string
}

export type ToolSpec = {
  name: string
  title: string
  summary: string
  fields: FieldSpec[]
}

export const MCP_TOOLS: ToolSpec[] = [
  {
    name: "sanction_authorize",
    title: "Authorize spend",
    summary: "Pre-authorize a purchase/subscription/transfer against the wallet's spend policy.",
    fields: [
      { key: "action", type: "enum", required: true, enum: ["purchase", "subscribe", "transfer"], help: "Type of spend action" },
      { key: "amount_usd", type: "number", required: true, placeholder: "5", help: "Exact amount in USD" },
      { key: "merchant", type: "string", required: true, placeholder: "Anthropic", help: "Vendor or service name" },
      { key: "category", type: "string", required: true, placeholder: "software", help: "software, services, research, infrastructure, marketing, legal, other" },
      { key: "description", type: "string", required: false, help: "Shown to the owner on escalation" },
      { key: "grant_id", type: "string", required: false, help: "One-use grant from an approved escalation — identical fields required" },
      { key: "execution_jwt", type: "string", required: false, help: "Execution JWT — additionally enforces that execution's spend cap" },
    ],
  },
  {
    name: "sanction_authorize_provision",
    title: "Authorize provision",
    summary: "Pre-authorize provisioning resources (seats, licenses, infra) — resource list + spend ladder.",
    fields: [
      { key: "resource", type: "string", required: true, placeholder: "m365.license", help: "What is being provisioned" },
      { key: "line_item", type: "string", required: true, placeholder: "Microsoft 365 E3", help: "Concrete SKU or plan" },
      { key: "quantity", type: "integer", required: true, placeholder: "3", help: "Units to provision" },
      { key: "unit_price_usd", type: "number", required: false, placeholder: "36", help: "Per-unit price; quantity × unit must equal amount or AMOUNT_MISMATCH" },
      { key: "amount_usd", type: "number", required: true, placeholder: "108", help: "Total amount in USD" },
      { key: "category", type: "string", required: true, placeholder: "licenses", help: "Shares the wallet's category governance and daily budget" },
      { key: "description", type: "string", required: false, help: "Shown to the owner on escalation" },
      { key: "grant_id", type: "string", required: false, help: "One-use grant from an approved escalation" },
      { key: "execution_jwt", type: "string", required: false, help: "Execution JWT spend-cap enforcement" },
    ],
  },
  {
    name: "sanction_authorize_tool",
    title: "Authorize tool call",
    summary: "Pre-authorize invoking another tool/action against the wallet's tool-governance policy.",
    fields: [
      { key: "tool", type: "string", required: true, placeholder: "shell.exec", help: "Exact tool/action name about to be invoked" },
      { key: "server", type: "string", required: false, placeholder: "filesystem", help: "MCP server/integration the tool belongs to (advisory)" },
      { key: "arguments", type: "json", required: false, help: "Arguments the tool would be called with — surfaced on escalation" },
      { key: "grant_id", type: "string", required: false, help: "Grant from an approved tool escalation" },
    ],
  },
  {
    name: "sanction_authorize_capability",
    title: "Authorize capability",
    summary: "Pre-authorize acquiring a capability (skill install, plugin, new API) against capability policy.",
    fields: [
      { key: "capability", type: "string", required: true, placeholder: "plugin:browser", help: "Namespaced capability identifier" },
      { key: "arguments", type: "json", required: false, help: "Advisory context (version, source, config)" },
      { key: "grant_id", type: "string", required: false, help: "Grant from an approved capability escalation" },
    ],
  },
  {
    name: "sanction_log_tokens",
    title: "Log LLM tokens",
    summary: "Record token consumption against daily/monthly/pooled budgets; 402 names the horizon hit.",
    fields: [
      { key: "model", type: "string", required: true, placeholder: "claude-sonnet-4-6", help: "Model id exactly as the provider returns it" },
      { key: "tokens_in", type: "integer", required: true, placeholder: "1200", help: "Input token count" },
      { key: "tokens_out", type: "integer", required: true, placeholder: "300", help: "Output token count" },
      { key: "cost_usd", type: "number", required: true, placeholder: "0.012", help: "Actual billed cost — never an estimate" },
      { key: "task", type: "string", required: false, placeholder: "code-review", help: "Label for spend reports" },
    ],
  },
  {
    name: "sanction_log_outcome",
    title: "Log outcome",
    summary: "Record a business outcome; cost-per-outcome ceilings throttle spend to human-gated when crossed.",
    fields: [
      { key: "kind", type: "string", required: true, placeholder: "booking", help: "Outcome kind, lowercase, matches policy outcome_kind" },
      { key: "value_usd", type: "number", required: false, help: "Optional dollar value — reporting only" },
      { key: "play", type: "string", required: false, help: "Campaign/play label" },
      { key: "dedupe_key", type: "string", required: false, placeholder: "crm-record-123", help: "Same key = same outcome, never double-counted" },
    ],
  },
  {
    name: "sanction_request_execution",
    title: "Request execution JWT",
    summary: "Mint a short-lived JWT scoping credential labels within a hard spend cap.",
    fields: [
      { key: "scope", type: "string[]", required: true, placeholder: "STRIPE_KEY", help: "Credential labels the execution may inject (comma-separated in the form)" },
      { key: "budget_usd", type: "number", required: true, placeholder: "10", help: "Hard spend cap for this execution" },
      { key: "ttl_seconds", type: "integer", required: false, placeholder: "300", help: "60–3600; default 900" },
    ],
  },
  {
    name: "sanction_inject_credential",
    title: "Inject credential",
    summary: "Retrieve a decrypted credential using an execution JWT; audit-logged, scope-enforced.",
    fields: [
      { key: "jwt", type: "string", required: true, help: "Execution JWT from sanction_request_execution" },
      { key: "credential_label", type: "string", required: true, placeholder: "STRIPE_KEY", help: "Must be in the JWT's scope; case-sensitive" },
    ],
  },
  {
    name: "sanction_wallet_status",
    title: "Wallet status",
    summary: "Today/MTD token cost and spend, plus pending-approval count.",
    fields: [],
  },
  {
    name: "sanction_check_authorization",
    title: "Check authorization",
    summary: "Poll an escalated request; approval returns the one-use grant_id to retry with.",
    fields: [
      { key: "request_id", type: "string", required: true, help: "request_id from an escalated authorize/provision/tool response" },
    ],
  },
]

// ── Scenario matrix (docs/plans/mcp-test-ui.md) ────────────────────────────────
// `expect` drives the ✓/✗ verdict in run-all:
//   authorized       — result.isError false
//   denied           — isError true, and NOT the escalation instruction
//   escalated        — isError true and text mentions sanction_check_authorization
//   error-surfaced   — isError true and text carries a non-policy code verbatim
//   ok               — non-authorize tool succeeded (logged/minted/rendered)
export type ScenarioExpect = "authorized" | "denied" | "escalated" | "error-surfaced" | "ok"

export type Scenario = {
  id: number
  label: string
  tool: string
  args: Record<string, unknown>
  expect: ScenarioExpect
  note?: string
}

export const SCENARIOS: Scenario[] = [
  { id: 1, label: "Spend under auto-approve", tool: "sanction_authorize", expect: "authorized",
    args: { action: "purchase", amount_usd: 5, merchant: "Anthropic", category: "software", description: "API credits (test)" } },
  { id: 2, label: "Spend over escalation line", tool: "sanction_authorize", expect: "escalated",
    args: { action: "purchase", amount_usd: 500, merchant: "AWS", category: "infrastructure", description: "Reserved instance (test)" },
    note: "GTM §0 known issue: default policy perTxnMax $50 < escalateOver $100 checked first may DENY instead. A deny here is the pre-launch bug, not a UI failure." },
  { id: 3, label: "Blocked category", tool: "sanction_authorize", expect: "denied",
    args: { action: "purchase", amount_usd: 5, merchant: "CasinoRoyale", category: "gambling", description: "Should be blocked" } },
  { id: 4, label: "Grant field mismatch", tool: "sanction_authorize", expect: "denied",
    args: { action: "purchase", amount_usd: 9999, merchant: "AWS", category: "infrastructure", grant_id: "grant_nonexistent" },
    note: "Expect GRANT_MISMATCH (or invalid-grant code) — never authorized." },
  { id: 5, label: "Provision amount mismatch", tool: "sanction_authorize_provision", expect: "denied",
    args: { resource: "m365.license", line_item: "Microsoft 365 E3", quantity: 3, unit_price_usd: 36, amount_usd: 100, category: "licenses" },
    note: "3 × 36 = 108 ≠ 100 → AMOUNT_MISMATCH" },
  { id: 6, label: "Provision consistent + small", tool: "sanction_authorize_provision", expect: "authorized",
    args: { resource: "m365.license", line_item: "Microsoft 365 E3", quantity: 1, unit_price_usd: 12, amount_usd: 12, category: "licenses" } },
  { id: 7, label: "Sensitive tool escalates", tool: "sanction_authorize_tool", expect: "escalated",
    args: { tool: "shell.exec", server: "host", arguments: { cmd: "rm -rf /tmp/x" } } },
  { id: 8, label: "Capability policy verdict", tool: "sanction_authorize_capability", expect: "denied",
    args: { capability: "plugin:browser", arguments: { source: "npm" } },
    note: "Per demo policy; assert a machine-readable code is present whichever way it lands." },
  { id: 9, label: "Token log under budget", tool: "sanction_log_tokens", expect: "ok",
    args: { model: "claude-sonnet-4-6", tokens_in: 1200, tokens_out: 300, cost_usd: 0.01, task: "harness-test" } },
  { id: 10, label: "Outcome + dedupe", tool: "sanction_log_outcome", expect: "ok",
    args: { kind: "booking", value_usd: 250, play: "speed-to-lead", dedupe_key: "harness-demo-1" },
    note: "Run twice: first 'new', second 'deduped' — both ok." },
  { id: 11, label: "Mint execution JWT", tool: "sanction_request_execution", expect: "ok",
    args: { scope: ["STRIPE_KEY"], budget_usd: 10, ttl_seconds: 300 } },
  { id: 12, label: "Inject in-scope credential", tool: "sanction_inject_credential", expect: "ok",
    args: { jwt: "<from #11>", credential_label: "STRIPE_KEY" },
    note: "UI substitutes the live JWT from the last #11 run." },
  { id: 13, label: "Inject out-of-scope label", tool: "sanction_inject_credential", expect: "error-surfaced",
    args: { jwt: "<from #11>", credential_label: "DATABASE_URL" } },
  { id: 14, label: "Wallet status renders", tool: "sanction_wallet_status", expect: "ok", args: {} },
  { id: 15, label: "Exec budget cap enforced", tool: "sanction_authorize", expect: "denied",
    args: { action: "purchase", amount_usd: 45, merchant: "Anthropic", category: "software", execution_jwt: "<from #11>" },
    note: "$45 > the $10 exec cap → EXEC_BUDGET_EXCEEDED even if wallet policy would allow." },
  { id: 16, label: "Bad API key surfaces verbatim", tool: "sanction_wallet_status", expect: "error-surfaced", args: {},
    note: "Run with env override SANCTION_API_KEY=pxy_invalid — must NOT read as a policy denial." },
  { id: 17, label: "Unreachable API fails closed", tool: "sanction_authorize", expect: "error-surfaced",
    args: { action: "purchase", amount_usd: 5, merchant: "Anthropic", category: "software" },
    note: "Run with env override SANCTION_API_URL=http://127.0.0.1:9 — expect SANCTION_UNREACHABLE." },
  { id: 18, label: "Poll unknown request id", tool: "sanction_check_authorization", expect: "error-surfaced",
    args: { request_id: "req_nonexistent_harness" },
    note: "The live escalation poll is exercised by scenario 2's loop; this row pins the unknown-id error path." },
]

// Env overrides a scenario can request (16/17) — the API route allowlists these.
export const SCENARIO_ENV_OVERRIDES: Record<number, Record<string, string>> = {
  16: { SANCTION_API_KEY: "pxy_invalid_key_for_error_surface_test" },
  17: { SANCTION_API_URL: "http://127.0.0.1:9" },
}
