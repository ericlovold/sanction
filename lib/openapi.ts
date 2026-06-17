// OpenAPI 3.0 spec — Bedrock Action Group compatible
export const spec = {
  openapi: "3.0.0",
  info: {
    title: "Sanction Agent Governance API",
    version: "1.0.0",
    description:
      "Sanction is the permission stack for autonomous AI agents. Provides spend authorization, token budget tracking, encrypted credential injection, and clearance-level access control. Designed for use as an AWS Bedrock Action Group, MCP server, or direct API integration.",
    contact: { name: "Sanction", url: "https://sanction.ai" },
  },
  servers: [{ url: "https://proxy-ai-three.vercel.app/api/v1", description: "Production" }],
  components: {
    securitySchemes: {
      AgentApiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Sanction agent API key (prefix: pxy_). Issued per agent at registration. Used for data-plane calls (authorize, tokens, exec).",
      },
      ManagementKey: {
        type: "apiKey",
        in: "header",
        name: "x-mgmt-key",
        description: "Wallet owner management key (prefix: sk_). Issued once at wallet creation. Required for management-plane calls (register agents, manage vault, read stats).",
      },
      ExecutionJWT: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Short-lived execution JWT issued by POST /v1/exec. 15-minute TTL. Required for credential injection.",
      },
    },
    schemas: {
      AuthorizeRequest: {
        type: "object",
        required: ["action", "amount_usd", "merchant", "category"],
        properties: {
          action: { type: "string", enum: ["purchase", "subscribe", "transfer"], description: "Type of spend action the agent wants to perform" },
          amount_usd: { type: "number", minimum: 0.01, description: "Amount in US dollars" },
          merchant: { type: "string", description: "Vendor or service name" },
          category: { type: "string", description: "Spend category (e.g. software, services, research, infrastructure)" },
          description: { type: "string", description: "Optional description of what this spend is for" },
          task_label: { type: "string", description: "Optional attribution: the task this spend serves (powers per-task reporting)" },
          job_id: { type: "string", description: "Optional attribution: job/run id" },
          repo: { type: "string", description: "Optional attribution: repository" },
          tool_name: { type: "string", description: "Optional attribution: tool that initiated the spend" },
        },
      },
      AuthorizeResponse: {
        type: "object",
        properties: {
          authorized: { type: "boolean" },
          status: { type: "string", enum: ["approved", "denied", "escalated", "pending"] },
          reason: { type: "string", description: "Human-readable explanation of the decision" },
          code: {
            type: "string",
            enum: ["ESCALATION_REQUIRED", "NO_POLICY", "CATEGORY_BLOCKED", "CATEGORY_NOT_ALLOWED", "PER_TXN_LIMIT", "DAILY_BUDGET_EXCEEDED", "MONTHLY_BUDGET_EXCEEDED", "POLICY_DENIED"],
            description: "Stable machine-readable decision code (absent when approved). Branch on this to replan.",
          },
          remediation: { type: "string", description: "Suggested next step for the agent when not approved" },
          request_id: { type: "string" },
          agent: { type: "string" },
          amount_usd: { type: "number" },
          merchant: { type: "string" },
        },
      },
      ExecRevokeRequest: {
        type: "object",
        required: ["wallet_id", "jti"],
        properties: {
          wallet_id: { type: "string", description: "Wallet that owns the token" },
          jti: { type: "string", description: "The execution token id (jti) to revoke" },
        },
      },
      ExecRevokeResponse: {
        type: "object",
        properties: {
          jti: { type: "string" },
          status: { type: "string", enum: ["revoked"] },
          revoked_at: { type: "string", format: "date-time" },
        },
      },
      LogTokensRequest: {
        type: "object",
        required: ["model", "tokens_in", "tokens_out", "cost_usd"],
        properties: {
          model: { type: "string", description: "LLM model identifier (e.g. claude-sonnet-4-6, gpt-4o)" },
          tokens_in: { type: "integer", minimum: 0, description: "Input/prompt tokens consumed" },
          tokens_out: { type: "integer", minimum: 0, description: "Output/completion tokens generated" },
          cost_usd: { type: "number", minimum: 0, description: "Actual dollar cost of this inference call" },
          task: { type: "string", description: "Optional label for the task this call served" },
        },
      },
      ExecTokenRequest: {
        type: "object",
        required: ["scope", "budget_usd"],
        properties: {
          scope: { type: "array", items: { type: "string" }, description: "Credential labels this execution needs access to" },
          budget_usd: { type: "number", minimum: 0.01, description: "Maximum spend authority for this execution" },
          ttl_seconds: { type: "integer", minimum: 60, maximum: 3600, default: 900, description: "Token lifetime in seconds. Default 900 (15 min)." },
          container_id: { type: "string", description: "Optional identifier for the container claiming this token" },
        },
      },
      ExecTokenResponse: {
        type: "object",
        properties: {
          jwt: { type: "string", description: "Signed JWT. Pass as Authorization: Bearer <jwt> to /credentials/inject" },
          jti: { type: "string", description: "Unique token ID for audit trail" },
          expires_at: { type: "string", format: "date-time" },
          clearance: { type: "integer", minimum: 1, maximum: 5 },
          scope: { type: "array", items: { type: "string" } },
          budget_usd: { type: "number" },
          ttl_seconds: { type: "integer" },
        },
      },
      CredentialInjectRequest: {
        type: "object",
        required: ["credential_label"],
        properties: {
          credential_label: { type: "string", description: "Label of the credential to inject. Must be in JWT scope." },
        },
      },
      CredentialInjectResponse: {
        type: "object",
        properties: {
          label: { type: "string" },
          type: { type: "string" },
          value: { type: "string", description: "Decrypted credential value. Valid for the duration of the execution JWT." },
          injected_at: { type: "string", format: "date-time" },
          expires_at: { type: "string", format: "date-time" },
        },
      },
      WalletStatsResponse: {
        type: "object",
        properties: {
          today: {
            type: "object",
            properties: {
              token_cost_usd: { type: "number" },
              tokens_in: { type: "integer" },
              tokens_out: { type: "integer" },
              spend_usd: { type: "number" },
            },
          },
          month: {
            type: "object",
            properties: {
              token_cost_usd: { type: "number" },
              spend_usd: { type: "number" },
            },
          },
          pending_approvals: { type: "integer" },
        },
      },
      AgentDeactivateRequest: {
        type: "object",
        required: ["wallet_id", "agent_id"],
        properties: {
          wallet_id: { type: "string" },
          agent_id: { type: "string" },
          active: { type: "boolean", description: "Default false (deactivate). Pass true to re-activate.", default: false },
        },
      },
      AgentStateResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          api_key_prefix: { type: "string" },
          is_active: { type: "boolean" },
        },
      },
      Policy: {
        type: "object",
        description: "Wallet spend/governance policy. All *Usd fields are integer cents.",
        properties: {
          dailyTokenBudgetUsd: { type: "integer", minimum: 0, description: "Daily LLM token-cost cap (cents)" },
          dailySpendBudgetUsd: { type: "integer", minimum: 0, description: "Daily real-money spend cap (cents)" },
          perTransactionMaxUsd: { type: "integer", minimum: 0, description: "Hard per-transaction ceiling (cents); spend above this is denied" },
          autoApproveUnderUsd: { type: "integer", minimum: 0, description: "Spend at/under this auto-approves (cents)" },
          escalateOverUsd: { type: "integer", minimum: 0, description: "Spend above this escalates to a human (cents); must be < perTransactionMaxUsd" },
          monthlySpendBudgetUsd: { type: "integer", minimum: 0, nullable: true, description: "Optional monthly real-money spend cap (cents); null = no monthly cap" },
          allowedCategories: { type: "array", items: { type: "string" } },
          blockedCategories: { type: "array", items: { type: "string" } },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      PolicyUpdateRequest: {
        type: "object",
        required: ["wallet_id"],
        description: "Partial update — only the fields supplied are changed. Field shape matches the `policy` block in examples/policies/*.json.",
        properties: {
          wallet_id: { type: "string" },
          dailyTokenBudgetUsd: { type: "integer", minimum: 0 },
          dailySpendBudgetUsd: { type: "integer", minimum: 0 },
          perTransactionMaxUsd: { type: "integer", minimum: 0 },
          autoApproveUnderUsd: { type: "integer", minimum: 0 },
          escalateOverUsd: { type: "integer", minimum: 0 },
          monthlySpendBudgetUsd: { type: "integer", minimum: 0, nullable: true },
          allowedCategories: { type: "array", items: { type: "string" } },
          blockedCategories: { type: "array", items: { type: "string" } },
        },
      },
      PolicyResponse: {
        type: "object",
        properties: {
          wallet_id: { type: "string" },
          policy: { $ref: "#/components/schemas/Policy" },
        },
      },
      AuditEvent: {
        type: "object",
        description: "Normalized audit-feed entry. `type` is e.g. authorization.approved, token.logged, vault.injection. Extra fields vary by type.",
        properties: {
          type: { type: "string" },
          id: { type: "string" },
          at: { type: "string", format: "date-time" },
          agent_id: { type: "string" },
          agent_name: { type: "string" },
        },
        additionalProperties: true,
      },
      AuditEventsResponse: {
        type: "object",
        properties: {
          wallet_id: { type: "string" },
          events: { type: "array", items: { $ref: "#/components/schemas/AuditEvent" } },
          next_before: { type: "string", format: "date-time", nullable: true, description: "Cursor for the next page, or null when caught up." },
        },
      },
      DailySummaryResponse: {
        type: "object",
        properties: {
          wallet_id: { type: "string" },
          date: { type: "string" },
          spend_usd: { type: "number" },
          decisions: {
            type: "object",
            properties: {
              approved: { type: "integer" },
              denied: { type: "integer" },
              escalated: { type: "integer" },
              pending: { type: "integer" },
            },
          },
          token_cost_usd: { type: "number" },
          tokens_in: { type: "integer" },
          tokens_out: { type: "integer" },
          secret_accesses: { type: "integer" },
          most_expensive_tasks: {
            type: "array",
            items: { type: "object", properties: { task_label: { type: "string" }, cost_usd: { type: "number" } } },
          },
        },
      },
      ClearanceAssignRequest: {
        type: "object",
        required: ["wallet_id", "agent_id", "level"],
        properties: {
          wallet_id: { type: "string", description: "Wallet that owns the agent" },
          agent_id: { type: "string", description: "Agent to assign clearance to" },
          level: { type: "integer", minimum: 1, maximum: 5, description: "Clearance level 1-5. Higher levels satisfy lower credential requirements." },
          industry: { type: "string", enum: ["general", "healthcare", "legal", "financial", "enterprise"], default: "general", description: "Industry domain this clearance applies to" },
          expires_at: { type: "string", format: "date-time", description: "Optional expiry; an expired clearance falls back to level 1." },
          restrictions: { type: "object", additionalProperties: true, description: "Optional additional constraints at this clearance level" },
        },
      },
      ClearanceResponse: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          wallet_id: { type: "string" },
          level: { type: "integer", minimum: 1, maximum: 5 },
          industry: { type: "string", enum: ["general", "healthcare", "legal", "financial", "enterprise"] },
          granted_at: { type: "string", format: "date-time" },
          expires_at: { type: "string", format: "date-time", nullable: true },
          restrictions: { type: "object", additionalProperties: true },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/authorize": {
      post: {
        operationId: "authorizeSpend",
        summary: "Authorize a spend action",
        description:
          "Check whether an agent is permitted to make a purchase, subscription, or transfer. Always call this before any financial transaction. Returns immediately with approved, denied, or escalated status. Escalated means a human must approve before proceeding.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthorizeRequest" } } },
        },
        responses: {
          "200": {
            description: "Authorization decision",
            headers: { "x-autoflux-clearance": { schema: { type: "integer" }, description: "Agent clearance level used for this decision" } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthorizeResponse" } } },
          },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Denied by policy", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/tokens": {
      post: {
        operationId: "logTokenUsage",
        summary: "Log LLM token consumption",
        description:
          "Record the token and cost of an LLM inference call. Used for budget tracking and audit. Call this after every Claude, GPT, Gemini, or other LLM API call. Returns 402 if the daily token budget is exceeded.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LogTokensRequest" } } },
        },
        responses: {
          "200": { description: "Token usage recorded" },
          "401": { description: "Invalid API key" },
          "402": { description: "Daily token budget exceeded" },
        },
      },
    },
    "/exec": {
      post: {
        operationId: "requestExecutionToken",
        summary: "Issue a scoped execution JWT",
        description:
          "Issue a short-lived (default 15min) signed JWT authorizing access to a specific set of credentials within a capped budget. Pass this JWT to a Docker container, subprocess, or code-generating agent. The JWT is required to call /credentials/inject.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ExecTokenRequest" } } },
        },
        responses: {
          "200": {
            description: "Execution token issued",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExecTokenResponse" } } },
          },
          "401": { description: "Invalid API key" },
          "403": { description: "Agent not authorized for requested credentials, or clearance insufficient for a credential requiring a higher level" },
        },
      },
    },
    "/agents/clearance": {
      post: {
        operationId: "assignAgentClearance",
        summary: "Assign or update an agent's clearance",
        description:
          "Set an agent's clearance level (1-5) and industry domain. Upserts the agent's clearance record. Clearance gates credential access in /exec: a credential tagged with a `clearance:N` scope can only be issued to an agent at level N or higher. Management-plane: requires the wallet management key.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ClearanceAssignRequest" } } },
        },
        responses: {
          "200": {
            description: "Clearance assigned",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClearanceResponse" } } },
          },
          "400": { description: "Invalid request (e.g. level out of 1-5 range or unknown industry)" },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "Agent not found in this wallet" },
        },
      },
    },
    "/exec/revoke": {
      post: {
        operationId: "revokeExecutionToken",
        summary: "Revoke an outstanding execution token",
        description:
          "Owner-only. Immediately revokes an execution JWT before its TTL elapses — subsequent /credentials/inject calls with that token are rejected. Scoped to the owner's wallet.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ExecRevokeRequest" } } },
        },
        responses: {
          "200": {
            description: "Token revoked",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExecRevokeResponse" } } },
          },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "No active token with that jti for this wallet" },
        },
      },
    },
    "/credentials/inject": {
      post: {
        operationId: "injectCredential",
        summary: "Inject a decrypted credential for the current execution",
        description:
          "Present a valid execution JWT and receive a decrypted credential value. The credential must be in the JWT scope. Every injection is audit-logged. Raw credential values are never stored in logs — only the credential label and injection timestamp are recorded.",
        security: [{ ExecutionJWT: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CredentialInjectRequest" } } },
        },
        responses: {
          "200": {
            description: "Credential injected",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CredentialInjectResponse" } } },
          },
          "401": { description: "Invalid or expired JWT" },
          "403": { description: "Credential not in JWT scope" },
          "404": { description: "Credential not found in vault" },
        },
      },
    },
    "/agents/deactivate": {
      post: {
        operationId: "setAgentActive",
        summary: "Deactivate or re-activate an agent key",
        description:
          "Owner-only. Deactivates an agent's API key (default) so it fails authentication immediately — use this to rotate a leaked or retired key. Pass active=true to re-enable. Idempotent; scoped to the owner's wallet.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AgentDeactivateRequest" } } },
        },
        responses: {
          "200": { description: "Updated agent state", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentStateResponse" } } } },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "Agent not found in this wallet" },
        },
      },
    },
    "/wallets/policy": {
      get: {
        operationId: "getWalletPolicy",
        summary: "Read a wallet's policy",
        description: "Returns the current spend/governance policy for a wallet. Management-plane: requires the wallet management key.",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Wallet policy", content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyResponse" } } } },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "No policy for this wallet" },
        },
      },
      patch: {
        operationId: "updateWalletPolicy",
        summary: "Update a wallet's policy",
        description:
          "Partial-update the wallet's spend/governance policy. Only supplied fields change; omitted fields are unchanged. Apply a policy blueprint by sending its `policy` block. Management-plane: requires the wallet management key.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyUpdateRequest" } } },
        },
        responses: {
          "200": { description: "Updated policy", content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyResponse" } } } },
          "400": { description: "Invalid request or no fields supplied" },
          "401": { description: "Missing or invalid management key" },
          "422": { description: "Policy invariant violated (e.g. escalateOverUsd >= perTransactionMaxUsd)" },
        },
      },
    },
    "/audit-events": {
      get: {
        operationId: "getAuditEvents",
        summary: "Unified audit feed for a wallet",
        description:
          "Time-sorted feed of spend decisions, token usage, and credential injections (secret access). Filter by type (authorization|token|injection), page with limit + before (ISO cursor). Readable by the wallet management key or any active agent in the wallet.",
        security: [{ ManagementKey: [] }, { AgentApiKey: [] }],
        parameters: [
          { in: "query", name: "wallet_id", required: true, schema: { type: "string" } },
          { in: "query", name: "type", required: false, schema: { type: "string", enum: ["authorization", "token", "injection"] } },
          { in: "query", name: "limit", required: false, schema: { type: "integer", default: 50, minimum: 1, maximum: 200 } },
          { in: "query", name: "before", required: false, schema: { type: "string", format: "date-time" }, description: "Return events strictly before this timestamp (cursor)." },
        ],
        responses: {
          "200": { description: "Audit events", content: { "application/json": { schema: { $ref: "#/components/schemas/AuditEventsResponse" } } } },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/reporting/daily-summary": {
      get: {
        operationId: "getDailySummary",
        summary: "One UTC-day activity rollup for a wallet",
        description:
          "Spend, approve/deny/escalate counts, token cost, secret-access count, and the most expensive tasks for a single UTC day. Defaults to today. Readable by the wallet management key or any active agent in the wallet.",
        security: [{ ManagementKey: [] }, { AgentApiKey: [] }],
        parameters: [
          { in: "query", name: "wallet_id", required: true, schema: { type: "string" } },
          { in: "query", name: "date", required: false, schema: { type: "string", example: "2026-06-17" }, description: "UTC day (YYYY-MM-DD). Defaults to today." },
        ],
        responses: {
          "200": { description: "Daily summary", content: { "application/json": { schema: { $ref: "#/components/schemas/DailySummaryResponse" } } } },
          "400": { description: "Bad date" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/wallets/stats": {
      get: {
        operationId: "getWalletStats",
        summary: "Get wallet spend and token usage summary",
        description: "Returns today and month-to-date token cost, real-money spend, and count of pending approvals for a wallet.",
        security: [{ AgentApiKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Wallet stats",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WalletStatsResponse" } } },
          },
        },
      },
    },
  },
}
