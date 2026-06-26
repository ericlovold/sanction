// OpenAPI 3.0 spec — Bedrock Action Group compatible
export const spec = {
  openapi: "3.0.0",
  info: {
    title: "Sanction Agent Governance API",
    version: "1.0.0",
    description:
      "Sanction is the permission stack for autonomous AI agents. Provides spend authorization, token budget tracking, encrypted credential injection, and clearance-level access control. Designed for use as an AWS Bedrock Action Group, MCP server, or direct API integration.",
    contact: { name: "Sanction", url: "https://getsanction.com" },
  },
  servers: [{ url: "https://getsanction.com/api/v1", description: "Production" }],
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
            enum: ["ESCALATION_REQUIRED", "ESCALATION_TIMED_OUT", "NO_POLICY", "CATEGORY_BLOCKED", "CATEGORY_NOT_ALLOWED", "PER_TXN_LIMIT", "DAILY_BUDGET_EXCEEDED", "EXEC_BUDGET_EXCEEDED", "POLICY_DENIED"],
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
      RegisterAgentRequest: {
        type: "object",
        required: ["wallet_id", "name"],
        properties: {
          wallet_id: { type: "string" },
          name: { type: "string", minLength: 1, maxLength: 64, description: "Agent name. Carry your tenant id here (e.g. tenant_<id>) to map one agent per tenant." },
        },
      },
      AgentKeyResponse: {
        type: "object",
        description: "Returned on register and rotate. api_key is shown once and never retrievable again.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          api_key: { type: "string", description: "The agent key (pxy_...). Store it now — shown once." },
          api_key_prefix: { type: "string" },
          wallet_id: { type: "string" },
          created_at: { type: "string", format: "date-time" },
          warning: { type: "string" },
        },
      },
      AgentListResponse: {
        type: "object",
        properties: {
          agents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                apiKeyPrefix: { type: "string" },
                isActive: { type: "boolean" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      RotateAgentRequest: {
        type: "object",
        required: ["wallet_id", "agent_id"],
        properties: {
          wallet_id: { type: "string" },
          agent_id: { type: "string" },
        },
      },
      UpdateAgentRequest: {
        type: "object",
        required: ["wallet_id", "agent_id"],
        description: "Per-agent overrides. A number sets a $ override; null clears it (inherit wallet policy); omitting a field leaves it unchanged.",
        properties: {
          wallet_id: { type: "string" },
          agent_id: { type: "string" },
          daily_token_budget_usd: { type: "number", minimum: 0, nullable: true },
          daily_spend_budget_usd: { type: "number", minimum: 0, nullable: true },
          per_transaction_max_usd: { type: "number", minimum: 0, nullable: true },
          escalate_over_usd: { type: "number", minimum: 0, nullable: true },
          clearance: { type: "integer", minimum: 1, maximum: 5 },
          active: { type: "boolean", description: "false revokes the agent's key; true reactivates it (SEC-6)." },
        },
      },
      UpdateAgentResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          active: { type: "boolean" },
          clearance: { type: "integer", nullable: true },
          overrides: {
            type: "object",
            properties: {
              daily_token_budget_usd: { type: "number", nullable: true },
              daily_spend_budget_usd: { type: "number", nullable: true },
              per_transaction_max_usd: { type: "number", nullable: true },
              escalate_over_usd: { type: "number", nullable: true },
            },
          },
        },
      },
      PolicyObject: {
        type: "object",
        description: "Wallet spend policy. Amounts in dollars.",
        properties: {
          daily_token_budget_usd: { type: "number" },
          daily_spend_budget_usd: { type: "number" },
          per_transaction_max_usd: { type: "number" },
          auto_approve_under_usd: { type: "number", description: "At or under this, auto-approve and never escalate (floor wins over escalation)." },
          escalate_over_usd: { type: "number", description: "Over this (and over the auto-approve floor), escalate to a human." },
          allowed_categories: { type: "array", items: { type: "string" }, description: "Non-empty = allow-list (only these may spend). Empty = allow all." },
          blocked_categories: { type: "array", items: { type: "string" } },
          escalation_timeout_mins: { type: "integer", description: "0 = never auto-resolve an escalation." },
          escalation_timeout_action: { type: "string", enum: ["deny", "approve"] },
        },
      },
      PolicyUpdateRequest: {
        type: "object",
        required: ["wallet_id"],
        description: "Partial — only the fields you send change. Amounts in dollars.",
        properties: {
          wallet_id: { type: "string" },
          daily_token_budget_usd: { type: "number", minimum: 0 },
          daily_spend_budget_usd: { type: "number", minimum: 0 },
          per_transaction_max_usd: { type: "number", minimum: 0 },
          auto_approve_under_usd: { type: "number", minimum: 0 },
          escalate_over_usd: { type: "number", minimum: 0 },
          allowed_categories: { type: "array", items: { type: "string" } },
          blocked_categories: { type: "array", items: { type: "string" } },
          escalation_timeout_mins: { type: "integer", minimum: 0, maximum: 10080 },
          escalation_timeout_action: { type: "string", enum: ["deny", "approve"] },
        },
      },
      PolicyResponse: {
        type: "object",
        properties: {
          wallet_id: { type: "string" },
          policy: { $ref: "#/components/schemas/PolicyObject" },
        },
      },
      CreateWalletRequest: {
        type: "object",
        required: ["name", "owner_email"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          owner_email: { type: "string", format: "email" },
          parent_id: { type: "string", description: "Create as a sub-account under this wallet (account tree). Requires the parent's x-mgmt-key. Omit for a root wallet." },
        },
      },
      CreateWalletResponse: {
        type: "object",
        description: "management_key is shown once and never retrievable again.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          owner_email: { type: "string" },
          parent_id: { type: "string", nullable: true },
          management_key: { type: "string", description: "Owner key (sk_...). Store it now — shown once." },
          management_key_prefix: { type: "string" },
          warning: { type: "string" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      SpendSummary: {
        type: "object",
        properties: {
          today_usd: { type: "number" },
          month_usd: { type: "number" },
          token_today_usd: { type: "number" },
        },
      },
      AccountTreeNode: {
        type: "object",
        description: "A wallet node with its own spend and the rolled-up total of its whole subtree.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          parent_id: { type: "string", nullable: true },
          spend: { $ref: "#/components/schemas/SpendSummary" },
          rollup: { $ref: "#/components/schemas/SpendSummary" },
          children: { type: "array", items: { $ref: "#/components/schemas/AccountTreeNode" } },
        },
      },
      WalletTreeResponse: {
        type: "object",
        properties: {
          wallet_id: { type: "string" },
          nodes: { type: "integer", description: "Number of wallets in the returned subtree." },
          truncated: { type: "boolean", description: "True if the subtree hit the depth/node cap." },
          tree: { $ref: "#/components/schemas/AccountTreeNode" },
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
            description: "Authorization decision (200 for approved/escalated; 403 for denied)",
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
          "403": { description: "Agent not authorized for requested credentials" },
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
    "/agents": {
      post: {
        operationId: "registerAgent",
        summary: "Register (provision) a new agent",
        description: "Create an agent under a wallet and receive its API key once. Use this to auto-provision one agent per tenant. Management-plane (x-mgmt-key).",
        security: [{ ManagementKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterAgentRequest" } } } },
        responses: {
          "201": { description: "Agent created; api_key shown once", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentKeyResponse" } } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid management key" },
        },
      },
      get: {
        operationId: "listAgents",
        summary: "List a wallet's agents",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Agents", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentListResponse" } } } },
          "401": { description: "Missing or invalid management key" },
        },
      },
      patch: {
        operationId: "updateAgent",
        summary: "Set per-agent budgets, clearance, or active state",
        description: "Override budgets per agent (null clears to inherit the wallet policy), set clearance, or revoke/reactivate the key with { active }. Management-plane.",
        security: [{ ManagementKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateAgentRequest" } } } },
        responses: {
          "200": { description: "Updated agent", content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateAgentResponse" } } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "Agent not found in this wallet" },
        },
      },
    },
    "/agents/rotate": {
      post: {
        operationId: "rotateAgentKey",
        summary: "Rotate an agent's API key",
        description: "Issue a fresh key for an agent; the old key stops working immediately and the new key is shown once. To revoke without re-issuing, PATCH /agents with { active: false }. Management-plane (SEC-6).",
        security: [{ ManagementKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RotateAgentRequest" } } } },
        responses: {
          "200": { description: "Key rotated; new api_key shown once", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentKeyResponse" } } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "Agent not found in this wallet" },
        },
      },
    },
    "/wallets/policy": {
      get: {
        operationId: "getPolicy",
        summary: "Read a wallet's spend policy",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Policy", content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyResponse" } } } },
          "401": { description: "Missing or invalid management key" },
          "404": { description: "No policy configured" },
        },
      },
      patch: {
        operationId: "updatePolicy",
        summary: "Update budgets, thresholds, and categories",
        description: "Partial update of the wallet spend policy. Only fields you send change. Amounts in dollars. Management-plane.",
        security: [{ ManagementKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyUpdateRequest" } } } },
        responses: {
          "200": { description: "Updated policy", content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyResponse" } } } },
          "400": { description: "Invalid policy", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid management key" },
        },
      },
    },
    "/wallets": {
      post: {
        operationId: "createWallet",
        summary: "Create a wallet (master account) or a sub-account",
        description: "Create a root wallet (unauthenticated sign-up), or — with parent_id plus the parent's x-mgmt-key — a sub-account in the account tree. Returns a management key once.",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWalletRequest" } } } },
        responses: {
          "201": { description: "Wallet created; management_key shown once", content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWalletResponse" } } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "parent_id given but the management key is missing/invalid" },
          "409": { description: "A wallet already exists for this email" },
          "429": { description: "Root sign-up rate limit (per IP) exceeded" },
        },
      },
    },
    "/wallets/tree": {
      get: {
        operationId: "getWalletTree",
        summary: "Spend rolled up across a wallet's account subtree",
        description: "Read-only. Returns the wallet and its descendant sub-accounts, each with its own spend and the rolled-up total of its whole subtree — one number for the fleet. Bounded depth/size. Management-plane.",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Subtree with rolled-up spend", content: { "application/json": { schema: { $ref: "#/components/schemas/WalletTreeResponse" } } } },
          "401": { description: "Missing or invalid management key" },
        },
      },
    },
  },
}
