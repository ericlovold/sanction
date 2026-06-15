// OpenAPI 3.0 spec — Bedrock Action Group compatible
export const spec = {
  openapi: "3.0.0",
  info: {
    title: "AutoFlux Agent Governance API",
    version: "1.0.0",
    description:
      "AutoFlux is the permission stack for autonomous AI agents. Provides spend authorization, token budget tracking, encrypted credential injection, and clearance-level access control. Designed for use as an AWS Bedrock Action Group, MCP server, or direct API integration.",
    contact: { name: "AutoFlux", url: "https://autoflux.ai" },
  },
  servers: [{ url: "https://proxy-ai-three.vercel.app/api/v1", description: "Production" }],
  components: {
    securitySchemes: {
      AgentApiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "AutoFlux agent API key (prefix: pxy_). Issued per agent at registration.",
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
          reason: { type: "string" },
          request_id: { type: "string" },
          agent: { type: "string" },
          amount_usd: { type: "number" },
          merchant: { type: "string" },
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
          "403": { description: "Agent not authorized for requested credentials" },
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
  },
}
