// OpenAPI 3.0 spec — Bedrock Action Group compatible
export const spec = {
  openapi: "3.0.0",
  info: {
    title: "Sanction Agent Governance API",
    version: "1.0.0",
    description:
      "Sanction is the permission stack for autonomous AI agents. Provides spend authorization, token budget tracking, encrypted credential injection, and clearance-level access control. Designed for use as an AWS Bedrock Action Group, MCP server, or direct API integration. Terminology: an agent is a seat — a governed identity you hand to whoever holds it (named holder, auto-expiry, key rotation that keeps history). The API keeps the agent noun; product surfaces say seat.",
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
          tags: {
            type: "object",
            additionalProperties: { type: "string", maxLength: 80 },
            maxProperties: 8,
            description:
              "Optional attribution tags (≤8; e.g. {\"channel\":\"paid-media\",\"play\":\"d2c-search\"}). Stored on the decision and surfaced in the audit feed/CSV for rollups. Never read by policy rules.",
          },
          grant_id: {
            type: "string",
            description: "Short-lived approval grant returned from GET /authorize/{request_id}. Retry the exact approved request with this field to consume the grant.",
          },
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
            enum: [
              "ESCALATION_REQUIRED",
              "ESCALATION_TIMED_OUT",
              "NO_POLICY",
              "CATEGORY_BLOCKED",
              "CATEGORY_NOT_ALLOWED",
              "PER_TXN_LIMIT",
              "DAILY_BUDGET_EXCEEDED",
              "MONTHLY_BUDGET_EXCEEDED",
              "SUBTREE_CAP_EXCEEDED",
              "EXEC_BUDGET_EXCEEDED",
              "GRANT_NOT_FOUND",
              "GRANT_ALREADY_USED",
              "GRANT_EXPIRED",
              "GRANT_MISMATCH",
              "GRANT_UNSUPPORTED",
              "POLICY_DENIED",
            ],
            description: "Stable machine-readable decision code (absent when approved). Branch on this to replan.",
          },
          remediation: { type: "string", description: "Suggested next step for the agent when not approved" },
        limit: {
          type: "object",
          description: "UX-3: the limit that fired, with live values from the decision's stored evidence.",
          properties: {
            kind: { type: "string", enum: ["per_transaction", "daily_spend_budget", "monthly_spend_budget", "escalation_band"] },
            limit_usd: { type: "number" },
            used_usd: { type: "number" },
            remaining_usd: { type: "number" },
            requested_usd: { type: "number" },
            resets_at: { type: "string", format: "date-time" },
          },
        },
        links: {
          type: "object",
          properties: { record: { type: "string" }, evidence: { type: "string" } },
        },
        access_request: {
          type: "object",
          description: "Present on hard budget denials: the signed appeal offer (AARP) — POST it to /access/v1/access-request to put the denial in front of a human.",
          properties: { endpoint: { type: "string" }, expires_at: { type: "string", format: "date-time" }, binding_token: { type: "string" } },
        },
          request_id: { type: "string" },
          agent: { type: "string" },
          amount_usd: { type: "number" },
          merchant: { type: "string" },
          grant_id: { type: "string", description: "Grant issued by a human approval for this request" },
          grant_status: { type: "string", enum: ["active", "consumed", "expired", "revoked"] },
          grant_consumed_at: { type: "string", format: "date-time" },
          grant_expires_at: { type: "string", format: "date-time" },
        },
      },
      BatchSeatsRequest: {
        type: "object",
        required: ["wallet_id"],
        properties: {
          wallet_id: { type: "string" },
          seats: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" }, holder: { type: "string", description: "Who holds this seat (display/audit)" } },
            },
          },
          name_prefix: { type: "string", description: "With count: mints prefix-1..prefix-N" },
          count: { type: "integer", minimum: 1, maximum: 50 },
          template: {
            type: "object",
            properties: {
              daily_token_budget_usd: { type: "number" },
              daily_spend_budget_usd: { type: "number" },
              per_transaction_max_usd: { type: "number" },
              escalate_over_usd: { type: "number" },
              clearance: { type: "integer", minimum: 1, maximum: 5 },
              industry: { type: "string", enum: ["general", "healthcare", "legal", "financial", "enterprise"] },
              expires_at: { type: "string", format: "date-time", description: "Contractor auto-shutoff: every seat's key fails closed past this instant" },
            },
          },
        },
      },
      BatchSeatsResponse: {
        type: "object",
        properties: {
          wallet_id: { type: "string" },
          seats: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                holder: { type: "string" },
                expires_at: { type: "string", format: "date-time" },
                api_key: { type: "string", description: "Shown once; only the hash is stored" },
                api_key_prefix: { type: "string" },
              },
            },
          },
          warning: { type: "string" },
        },
      },
      ToolAuthorizeRequest: {
        type: "object",
        required: ["tool"],
        properties: {
          tool: { type: "string", description: "Exact name of the tool/action about to be invoked (e.g. github.create_deployment, shell.exec)" },
          server: { type: "string", description: "MCP server or integration the tool belongs to (e.g. github, filesystem) — matched on grant redemption" },
          arguments: { type: "object", additionalProperties: true, description: "Arguments the tool would be called with — advisory, not persisted" },
          grant_id: {
            type: "string",
            description: "One-use grant minted when a human approves the escalation. Retry the same tool (and server) with this field to consume it.",
          },
        },
      },
      ToolAuthorizeResponse: {
        type: "object",
        properties: {
          authorized: { type: "boolean" },
          status: { type: "string", enum: ["allowed", "denied", "escalated"] },
          request_id: { type: "string", description: "Present on escalations — poll /authorize/{id} or replay the Idempotency-Key for the terminal decision" },
          reason: { type: "string" },
          code: {
            type: "string",
            enum: [
              "TOOL_BLOCKED",
              "TOOL_NOT_ALLOWED",
              "TOOL_ESCALATION_REQUIRED",
              "NO_POLICY",
              "GRANT_NOT_FOUND",
              "GRANT_ALREADY_USED",
              "GRANT_EXPIRED",
              "GRANT_MISMATCH",
              "GRANT_UNSUPPORTED",
            ],
            description: "Machine-readable decision code (absent when allowed)",
          },
          remediation: { type: "string", description: "Hint for how the agent should proceed" },
          agent: { type: "string" },
          tool: { type: "string" },
          server: { type: "string" },
          grant_id: { type: "string", description: "Echoed on successful grant redemption" },
          grant_status: { type: "string", enum: ["consumed"] },
          grant_consumed_at: { type: "string", format: "date-time" },
        },
      },
      ProvisionAuthorizeRequest: {
        type: "object",
        required: ["resource", "line_item", "quantity", "amount_usd", "category"],
        properties: {
          resource: { type: "string", description: "What is being provisioned (e.g. azure.seat, m365.license)" },
          line_item: { type: "string", description: "The concrete SKU or plan (e.g. Microsoft 365 E3)" },
          quantity: { type: "integer", minimum: 1, description: "Number of units to provision" },
          unit_price_usd: { type: "number", minimum: 0.01, description: "Optional per-unit price; when supplied, quantity × unit_price_usd must equal amount_usd" },
          amount_usd: { type: "number", minimum: 0.01, description: "Total amount in US dollars" },
          category: { type: "string", description: "Spend category (shares the wallet's category governance and daily budget)" },
          description: { type: "string", description: "Optional description of what this provision is for" },
          grant_id: {
            type: "string",
            description: "Short-lived approval grant minted when a human approves the escalation. Retry the exact approved request with this field to consume the one-use grant.",
          },
        },
      },
      ProvisionAuthorizeResponse: {
        type: "object",
        properties: {
          authorized: { type: "boolean" },
          status: { type: "string", enum: ["approved", "denied", "escalated"] },
          reason: { type: "string", description: "Human-readable explanation of the decision" },
          code: {
            type: "string",
            enum: [
              "ESCALATION_REQUIRED",
              "ESCALATION_TIMED_OUT",
              "NO_POLICY",
              "RESOURCE_BLOCKED",
              "RESOURCE_NOT_ALLOWED",
              "CATEGORY_BLOCKED",
              "CATEGORY_NOT_ALLOWED",
              "AMOUNT_MISMATCH",
              "PER_TXN_LIMIT",
              "DAILY_BUDGET_EXCEEDED",
              "MONTHLY_BUDGET_EXCEEDED",
              "SUBTREE_CAP_EXCEEDED",
              "EXEC_BUDGET_EXCEEDED",
              "GRANT_NOT_FOUND",
              "GRANT_ALREADY_USED",
              "GRANT_EXPIRED",
              "GRANT_MISMATCH",
              "GRANT_UNSUPPORTED",
              "POLICY_DENIED",
            ],
            description: "Stable machine-readable decision code (absent when approved). Branch on this to replan.",
          },
          remediation: { type: "string", description: "Suggested next step for the agent when not approved" },
          request_id: { type: "string" },
          agent: { type: "string" },
          amount_usd: { type: "number" },
          resource: { type: "string" },
          line_item: { type: "string" },
          quantity: { type: "integer" },
          unit_price_usd: { type: "number" },
          grant_id: { type: "string", description: "Grant issued by a human approval for this request" },
          grant_status: { type: "string", enum: ["active", "consumed", "expired", "revoked"] },
          grant_consumed_at: { type: "string", format: "date-time" },
          grant_expires_at: { type: "string", format: "date-time" },
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
              spend_budget_usd: { type: "number", nullable: true },
              projected_spend_usd: { type: "number", nullable: true, description: "Linear end-of-day projection; null while the day is too young to extrapolate." },
              will_exhaust: { type: "boolean" },
              exhaust_at: { type: "string", format: "date-time", nullable: true },
            },
          },
          month: {
            type: "object",
            properties: {
              token_cost_usd: { type: "number" },
              spend_usd: { type: "number" },
              spend_budget_usd: { type: "number", nullable: true },
              projected_spend_usd: { type: "number", nullable: true, description: "Linear month-end projection; null early in the month." },
              will_exhaust: { type: "boolean" },
              exhaust_at: { type: "string", format: "date-time", nullable: true },
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
          monthly_token_budget_usd: { type: "number", minimum: 0, nullable: true, description: "Optional per-seat monthly token cap (dollars). Null clears (inherit / daily-only)." },
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
          monthly_token_budget_usd: { type: "number", nullable: true, description: "Optional per-seat monthly token cap (dollars). Null = daily budget only." },
          daily_spend_budget_usd: { type: "number" },
          monthly_spend_budget_usd: { type: "number", nullable: true, description: "Optional monthly spend cap (dollars). Null disables the monthly limit." },
          subtree_daily_cap_usd: { type: "number", nullable: true, description: "Optional tree-wide daily cap for this wallet and all descendants. Null disables subtree cap enforcement." },
          subtree_daily_token_cap_usd: { type: "number", nullable: true, description: "Optional pooled daily token cap: today's token cost across every seat in this wallet's subtree may not exceed this (gateway enforces pre-call). Null disables." },
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
          monthly_token_budget_usd: { type: "number", minimum: 0, nullable: true },
          daily_spend_budget_usd: { type: "number", minimum: 0 },
          monthly_spend_budget_usd: { type: "number", minimum: 0, nullable: true, description: "Optional monthly spend cap (dollars). Null disables the monthly limit." },
          subtree_daily_cap_usd: { type: "number", minimum: 0, nullable: true },
          subtree_daily_token_cap_usd: { type: "number", minimum: 0, nullable: true },
          per_transaction_max_usd: { type: "number", minimum: 0 },
          auto_approve_under_usd: { type: "number", minimum: 0 },
          escalate_over_usd: { type: "number", minimum: 0 },
          allowed_categories: { type: "array", items: { type: "string" } },
          blocked_categories: { type: "array", items: { type: "string" } },
          capability_rules: { $ref: "#/components/schemas/CapabilityRules" },
          escalation_timeout_mins: { type: "integer", minimum: 0, maximum: 10080 },
          escalation_timeout_action: { type: "string", enum: ["deny", "approve"] },
        },
      },
      CapabilityRules: {
        type: "array",
        maxItems: 200,
        description: "Ordered capability governance rules (CAP-1): namespaced prefix-glob patterns with block → allow-list → escalate precedence.",
        items: {
          type: "object",
          required: ["pattern", "effect"],
          properties: {
            pattern: { type: "string", minLength: 1, maxLength: 120, description: "e.g. skill:install:*, api:github.com/*" },
            effect: { type: "string", enum: ["block", "allow", "escalate"] },
          },
        },
      },
      SimulateEffectCounts: {
        type: "object",
        properties: { allow: { type: "integer" }, escalate: { type: "integer" }, deny: { type: "integer" } },
      },
      SimulateOutcome: {
        type: "object",
        properties: { effect: { type: "string", enum: ["allow", "escalate", "deny"] }, code: { type: "string", nullable: true } },
      },
      PolicyPackPolicy: {
        type: "object",
        description: "A pack's policy payload: any subset of the policy-update fields (dollars), minus wallet_id. Broader than SimulatePolicyCandidate — packs may carry fields the simulation can't overlay (token budgets, escalation timeouts).",
        properties: {
          daily_token_budget_usd: { type: "number", minimum: 0 },
          daily_spend_budget_usd: { type: "number", minimum: 0 },
          monthly_spend_budget_usd: { type: "number", minimum: 0, nullable: true },
          subtree_daily_cap_usd: { type: "number", minimum: 0, nullable: true },
          per_transaction_max_usd: { type: "number", minimum: 0 },
          auto_approve_under_usd: { type: "number", minimum: 0 },
          escalate_over_usd: { type: "number", minimum: 0 },
          allowed_categories: { type: "array", items: { type: "string" } },
          blocked_categories: { type: "array", items: { type: "string" } },
          allowed_tools: { type: "array", items: { type: "string" } },
          blocked_tools: { type: "array", items: { type: "string" } },
          escalate_tools: { type: "array", items: { type: "string" } },
          capability_rules: { $ref: "#/components/schemas/CapabilityRules" },
          escalation_timeout_mins: { type: "integer", minimum: 0, maximum: 10080 },
          escalation_timeout_action: { type: "string", enum: ["deny", "approve"] },
        },
      },
      SimulatePolicyCandidate: {
        type: "object",
        description: "Partial candidate policy, dollars — the policy-update field names, minus wallet_id. Fields the simulation cannot honor are echoed back as ignored_fields.",
        properties: {
          daily_spend_budget_usd: { type: "number", minimum: 0 },
          monthly_spend_budget_usd: { type: "number", minimum: 0, nullable: true },
          per_transaction_max_usd: { type: "number", minimum: 0 },
          auto_approve_under_usd: { type: "number", minimum: 0 },
          escalate_over_usd: { type: "number", minimum: 0 },
          allowed_categories: { type: "array", items: { type: "string" } },
          blocked_categories: { type: "array", items: { type: "string" } },
          capability_rules: { $ref: "#/components/schemas/CapabilityRules" },
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
      AuthZenEntity: {
        type: "object",
        required: ["type", "id"],
        description: "An AuthZEN subject or resource: a typed identifier with optional properties.",
        properties: {
          type: { type: "string" },
          id: { type: "string" },
          properties: { type: "object", additionalProperties: true },
        },
      },
      AuthZenAction: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          properties: { type: "object", additionalProperties: true },
        },
      },
      AuthZenEvaluationRequest: {
        type: "object",
        required: ["subject", "action", "resource"],
        description:
          "OpenID AuthZEN 1.0 evaluation request. subject.id must be the authenticated agent's id or name. resource.type selects the ladder: 'tool' (resource.id = tool name), 'spend' (properties: amount_usd required, category), 'provision' (resource.id = resource; properties: amount_usd required, category, quantity, unit_price_usd, line_item). Properties may be set on the resource or the action; action properties win.",
        properties: {
          subject: { $ref: "#/components/schemas/AuthZenEntity" },
          action: { $ref: "#/components/schemas/AuthZenAction" },
          resource: { $ref: "#/components/schemas/AuthZenEntity" },
          context: { type: "object", additionalProperties: true },
        },
      },
      AuthZenDecision: {
        type: "object",
        required: ["decision"],
        description:
          "AuthZEN decision. Per the spec a deny is a successful evaluation: HTTP 200 with decision:false. context carries Sanction's stable machine code (e.g. TOOL_BLOCKED, ESCALATION_REQUIRED, DAILY_BUDGET_EXCEEDED, SUBJECT_MISMATCH), the human reason, and a remediation hint. A would-escalate outcome is decision:false whose remediation names the Sanction endpoint that opens the real approval.",
        properties: {
          decision: { type: "boolean" },
          context: {
            type: "object",
            properties: {
              code: { type: "string" },
              reason: { type: "string" },
              remediation: { type: "string" },
            },
          },
        },
      },
      AuthZenEvaluationItem: {
        type: "object",
        description:
          "One batch evaluation: a member-wise override of the request's top-level defaults, so every field is optional. After merging, each item must have subject, action, and resource.",
        properties: {
          subject: { $ref: "#/components/schemas/AuthZenEntity" },
          action: { $ref: "#/components/schemas/AuthZenAction" },
          resource: { $ref: "#/components/schemas/AuthZenEntity" },
          context: { type: "object", additionalProperties: true },
        },
      },
      AuthZenEvaluationsRequest: {
        type: "object",
        description:
          "OpenID AuthZEN 1.0 batch request. Top-level subject/action/resource are defaults; each item in evaluations overrides them member-wise. Without an evaluations array the defaults are evaluated as a single evaluation. Max 50 items.",
        properties: {
          subject: { $ref: "#/components/schemas/AuthZenEntity" },
          action: { $ref: "#/components/schemas/AuthZenAction" },
          resource: { $ref: "#/components/schemas/AuthZenEntity" },
          context: { type: "object", additionalProperties: true },
          evaluations: { type: "array", maxItems: 50, items: { $ref: "#/components/schemas/AuthZenEvaluationItem" } },
          options: {
            type: "object",
            properties: {
              evaluations_semantic: {
                type: "string",
                enum: ["execute_all", "deny_on_first_deny", "permit_on_first_permit"],
                description: "execute_all (default) evaluates every item; the others stop at the first deny/permit and return results up to that point.",
              },
            },
          },
        },
      },
      AuthZenEvaluationsResponse: {
        type: "object",
        properties: {
          evaluations: { type: "array", items: { $ref: "#/components/schemas/AuthZenDecision" } },
        },
      },
      AarpAccessRequest: {
        type: "object",
        required: ["subject", "action", "resource", "denial"],
        description:
          "AuthZEN Access Request and Approval Profile (draft) submission: the denied subject/action/resource plus the binding_token from the requestable denial's context.access_request. Opens a real Sanction escalation in the owner's approval inbox.",
        properties: {
          subject: { $ref: "#/components/schemas/AuthZenEntity" },
          action: { $ref: "#/components/schemas/AuthZenAction" },
          resource: { $ref: "#/components/schemas/AuthZenEntity" },
          context: { type: "object", additionalProperties: true },
          denial: {
            type: "object",
            required: ["binding_token"],
            properties: {
              binding_token: { type: "string", description: "Signed token from the requestable denial — proves this submission is the denied evaluation." },
              expires_at: { type: "string", format: "date-time" },
              reason: { type: "string" },
            },
          },
          requested_access: { type: "object", additionalProperties: true },
        },
      },
      AarpTaskResponse: {
        type: "object",
        description:
          "The AARP task handle. status pending → poll status_endpoint; approved carries result.mode 'reevaluate' plus the approval object (approval.id is the one-use grant, approved_until its expiry) to present back to the evaluation endpoint as context.approval.",
        properties: {
          task: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string", enum: ["pending", "approved", "denied", "expired"] },
              status_endpoint: { type: "string" },
              expires_at: { type: "string", format: "date-time" },
              links: { type: "object", properties: { review: { type: "string" } } },
            },
          },
          result: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["reevaluate"] },
              approval: {
                type: "object",
                properties: {
                  id: { type: "string", description: "The one-use grant id — present as context.approval.id on re-evaluation." },
                  approved_at: { type: "string", format: "date-time" },
                  approved_until: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
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
          "Check whether an agent is permitted to make a purchase, subscription, or transfer. Always call this before any financial transaction. Returns immediately with approved, denied, or escalated status. Escalated means a human must approve before proceeding; after approval, retry the exact request with grant_id to consume the one-use grant.",
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
    "/authorize/provision": {
      post: {
        operationId: "authorizeProvision",
        summary: "Authorize a provisioning action",
        description:
          "Check whether an agent is permitted to provision a resource (seats, licenses, infrastructure) — resource + line item + quantity + dollars in one native call. The dollar side shares the wallet's spend ladder and daily budget; the resource side is governed by the wallet's resource block/allow/escalate lists. Escalated means a human must approve; after approval, retry the exact request with grant_id to consume the one-use grant.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ProvisionAuthorizeRequest" } } },
        },
        responses: {
          "200": {
            description: "Authorization decision (200 for approved/escalated; 403 for denied)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ProvisionAuthorizeResponse" } } },
          },
          "400": { description: "Malformed request (including quantity × unit_price_usd ≠ amount_usd)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Denied by policy", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/authorize/tool": {
      post: {
        operationId: "authorizeTool",
        summary: "Authorize a tool invocation",
        description:
          "Check whether an agent may invoke a tool or external action (an MCP tool, a shell command, a deploy). Governed by the wallet's tool block/allow/escalate lists; an empty allow-list allows all (governance is opt-in). Escalated invocations persist to the owner's approval inbox; approval mints a one-use grant — retry the same tool with grant_id to consume it, or poll /authorize/{id}. Supports Idempotency-Key: replaying the key returns the escalation's current state, including the terminal decision once resolved.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ToolAuthorizeRequest" } } },
        },
        responses: {
          "200": {
            description: "Authorization decision (200 for allowed/escalated; 403 for denied; 409 for an already-consumed grant)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ToolAuthorizeResponse" } } },
          },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Denied by policy or grant mismatch", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    // AuthZEN PDP surface: mounted at the spec-canonical /access/v1/* suffix off
    // the PDP base URL (https://getsanction.com/api), NOT under /api/v1 — hence
    // the path-level servers override. Any AuthZEN PEP pointed at that base
    // interoperates with zero Sanction-specific code.
    "/access/v1/evaluation": {
      servers: [{ url: "https://getsanction.com/api", description: "AuthZEN PDP base" }],
      post: {
        operationId: "authzenEvaluation",
        summary: "AuthZEN access evaluation (Sanction as PDP)",
        description:
          "OpenID AuthZEN Authorization API 1.0 single-evaluation endpoint. POST the standard subject/action/resource tuple and receive { decision: boolean } — evaluated against the same engine as /v1/authorize, but decision-only: nothing is persisted, no budget debited, no approval opened (the contract of ?simulate=true). resource.type routes the request: 'tool' → the tool block/allow/escalate ladder; 'spend' and 'provision' → the dollar ladders against live budget state. subject.id must be the authenticated agent's id or name. Echoes X-Request-ID.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthZenEvaluationRequest" } } },
        },
        responses: {
          "200": {
            description: "Evaluation result — a deny is HTTP 200 with decision:false",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthZenDecision" } } },
          },
          "400": { description: "Malformed request (including missing amount_usd for spend/provision)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/access/v1/evaluations": {
      servers: [{ url: "https://getsanction.com/api", description: "AuthZEN PDP base" }],
      post: {
        operationId: "authzenEvaluations",
        summary: "AuthZEN batch access evaluation",
        description:
          "OpenID AuthZEN 1.0 batch endpoint. Top-level subject/action/resource act as defaults each item overrides; options.evaluations_semantic selects execute_all (default), deny_on_first_deny, or permit_on_first_permit. Decision-only, like the single-evaluation endpoint.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthZenEvaluationsRequest" } } },
        },
        responses: {
          "200": {
            description: "Per-item results, in request order (possibly truncated by the chosen semantic)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthZenEvaluationsResponse" } } },
          },
          "400": { description: "Malformed request or item (the whole batch fails; the error names the item index)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/access/v1/access-request": {
      servers: [{ url: "https://getsanction.com/api", description: "AuthZEN PDP base" }],
      post: {
        operationId: "authzenAccessRequest",
        summary: "AARP: open an approval from a requestable denial",
        description:
          "AuthZEN Access Request and Approval Profile (draft 1). Submit the denied subject/action/resource with denial.binding_token (from the evaluation's context.access_request) to open a real Sanction escalation — it lands in the owner's approval inbox and notifies via email/Slack/webhooks. Returns the AARP task handle; poll its status_endpoint. Supports Idempotency-Key. Errors are RFC 9457 problem+json: 400 invalid_denial_binding (tampered token or mismatched tuple), 410 expired_denial.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AarpAccessRequest" } } },
        },
        responses: {
          "201": {
            description: "Escalation opened — task handle returned",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AarpTaskResponse" } } },
          },
          "200": {
            description: "Idempotent replay (Idempotency-Key already seen) — the existing task with its CURRENT status",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AarpTaskResponse" } } },
          },
          "400": { description: "Malformed request (plain error JSON), or invalid denial binding — tampered token or mismatched tuple (problem+json)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "subject.id does not match the authenticated agent", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "410": { description: "The denial has expired — re-evaluate for a fresh one (problem+json)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/access/v1/access-request/{id}": {
      servers: [{ url: "https://getsanction.com/api", description: "AuthZEN PDP base" }],
      get: {
        operationId: "authzenAccessRequestStatus",
        summary: "AARP: poll a task for its terminal state",
        description:
          "Task status for an open access request (wallet-scoped: any of the wallet's agent keys). pending until the owner decides or the policy timeout settles it; approved carries result.mode 'reevaluate' and the approval object — present it back to POST /access/v1/evaluation as context.approval to redeem the one-use grant.",
        security: [{ AgentApiKey: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Task state (with result.approval once approved)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AarpTaskResponse" } } },
          },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "404": { description: "Unknown task (problem+json)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/authorize/{id}/evidence": {
      get: {
        operationId: "getDecisionEvidence",
        summary: "Evidence view of a decision (revision, context, replay)",
        description:
          "EVID-1: returns the immutable policy revision that was in force when the engine decided, the exact context it evaluated, and a live replay — the same pure rules re-run over the stored context with a matches flag proving the record reproduces the outcome. Readable by the wallet's agent keys or the owner's management key.",
        security: [{ AgentApiKey: [] }, { ManagementKey: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Decision evidence with replay",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    request_id: { type: "string" },
                    kind: { type: "string" },
                    status: { type: "string" },
                    decided_at: { type: "string", format: "date-time", nullable: true },
                    decision_note: { type: "string" },
                    code: { type: "string" },
                    agent: { type: "string" },
                    policy_revision: {
                      type: "object",
                      nullable: true,
                      properties: {
                        revision: { type: "integer" },
                        created_at: { type: "string", format: "date-time" },
                        policy: { type: "object", additionalProperties: true, description: "Immutable snapshot, cents" },
                      },
                    },
                    decision: { type: "object", nullable: true, additionalProperties: true },
                    context: { type: "object", nullable: true, additionalProperties: true },
                    replay: {
                      type: "object",
                      nullable: true,
                      properties: {
                        effect: { type: "string" },
                        rule_id: { type: "string" },
                        code: { type: "string" },
                        reason: { type: "string" },
                        matches: { type: "boolean", description: "True when the replay reproduces the persisted outcome exactly" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Wallet agent key or management key required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "404": { description: "Request not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/authorize/capability": {
      post: {
        operationId: "authorizeCapability",
        summary: "Authorize acquiring or exercising a capability",
        description:
          "CAP-1: installing a skill, adding a plugin, calling a new API — new capability is a governed action. Evaluated against the wallet's ordered capability rules (namespaced prefix-glob patterns like skill:install:*, effect block/allow/escalate; empty = allow all). Escalations persist to the approval inbox with replayable evidence; approval mints a one-use grant — retry with grant_id to consume. Supports Idempotency-Key.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["capability"],
                properties: {
                  capability: { type: "string", description: "Namespaced capability id, e.g. skill:install:web-scraper, plugin:browser, api:github.com/repos" },
                  arguments: { type: "object", additionalProperties: true, description: "Advisory — not policy-evaluated or persisted" },
                  grant_id: { type: "string", description: "One-use grant from an approval; retry the same capability with this to consume it" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "allowed or escalated (poll /authorize/{id}, or replay the Idempotency-Key)" },
          "401": { description: "Invalid API key" },
          "403": { description: "Denied by policy or grant mismatch", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "Grant already consumed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/audit-events": {
      get: {
        operationId: "getAuditEvents",
        summary: "Unified audit feed (JSON or CSV)",
        description:
          "Merged, time-sorted feed of spend decisions, token logs, and secret access. Cursor-paginate with `before`. `format=csv` returns the same page spreadsheet-ready (RFC 4180, formula-injection neutralized) as an attachment.",
        security: [{ AgentApiKey: [] }, { ManagementKey: [] }],
        parameters: [
          { in: "query", name: "wallet_id", required: true, schema: { type: "string" } },
          { in: "query", name: "type", schema: { type: "string", enum: ["authorization", "token", "injection"] } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
          { in: "query", name: "before", schema: { type: "string", format: "date-time" } },
          { in: "query", name: "format", schema: { type: "string", enum: ["csv"] }, description: "Omit for JSON" },
        ],
        responses: {
          "200": { description: "Events page (application/json, or text/csv attachment with format=csv)" },
          "400": { description: "wallet_id missing, or before is not a valid ISO timestamp" },
          "401": { description: "Management key or wallet agent key required" },
        },
      },
    },
    "/reporting/summary": {
      get: {
        operationId: "getPeriodSummary",
        summary: "Period rollup: totals, day buckets, per-agent grouping",
        description:
          "REPORT-1: the daily summary over any range up to 92 days (defaults to the last 7). Totals for spend/decisions/tokens/secret access, a day-by-day series, and group_by=agent for the per-seat breakdown. Membership-gated like the other reporting surfaces.",
        security: [{ AgentApiKey: [] }, { ManagementKey: [] }],
        parameters: [
          { in: "query", name: "wallet_id", required: true, schema: { type: "string" } },
          { in: "query", name: "from", schema: { type: "string", format: "date" } },
          { in: "query", name: "to", schema: { type: "string", format: "date" } },
          { in: "query", name: "group_by", schema: { type: "string", enum: ["agent"] } },
        ],
        responses: {
          "200": { description: "Totals + days[] (+ by_agent[] when grouped)" },
          "400": { description: "Invalid range (reversed, malformed, or over 92 days)" },
          "401": { description: "Management key or wallet agent key required" },
        },
      },
    },
    "/policy/packs": {
      get: {
        operationId: "listPolicyPacks",
        summary: "List installable policy packs",
        description:
          "PACK-1: the curated pack catalog — installable starting policies mapped to the governance maturity ladder (metering-first → startup-defaults → team-workspace → compliance-baseline). Each pack is a partial policy in dollars, the policy-update shape. Public; rate-limited per IP.",
        security: [],
        responses: {
          "200": {
            description: "The pack catalog",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    packs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          tagline: { type: "string" },
                          audience: { type: "string" },
                          maturity: { type: "string", enum: ["metering", "authorization", "governance", "evidence"] },
                          policy: { $ref: "#/components/schemas/PolicyPackPolicy" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/policy/packs/{id}/preview": {
      post: {
        operationId: "previewPolicyPack",
        summary: "Simulate a pack against your recent history",
        description:
          "PACK-1: run a pack through the retro-simulation before applying it — what would this pack have done to your last 30 days (default; any range up to 92 days). Same engine and honesty envelope as POST /policy/simulate. Read + compute only. Owner-only.",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id"],
                properties: {
                  wallet_id: { type: "string" },
                  from: { type: "string", format: "date" },
                  to: { type: "string", format: "date" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Simulation report (the simulatePolicy shape) plus the pack identity" },
          "400": { description: "Invalid range or malformed body" },
          "401": { description: "Management key required" },
          "404": { description: "Unknown pack id" },
        },
      },
    },
    "/policy/packs/{id}/apply": {
      post: {
        operationId: "applyPolicyPack",
        summary: "Install a pack as the wallet policy",
        description:
          "PACK-1: apply the pack's fields as the wallet policy in one call. Flows through the same validate/convert/write path as PUT /wallets/policy, so the change writes an immutable PolicyRevision like every other policy mutation. Owner-only.",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["wallet_id"], properties: { wallet_id: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "Pack applied; returns the resulting policy in dollars" },
          "400": { description: "Malformed body or validation failure" },
          "401": { description: "Management key required" },
          "404": { description: "Unknown pack id" },
        },
      },
    },
    "/policy/simulate": {
      post: {
        operationId: "simulatePolicy",
        summary: "Replay stored decisions under a candidate policy",
        description:
          "SIM-1 (retro-simulation): POST a partial candidate policy (dollars, same shape as the policy update) and a range up to 92 days (defaults to the last 7); every stored decision in the window re-runs through the pure ladders with the candidate overlaid on its recorded context, and the response reports what flips — totals by effect, approved-spend delta, and the changed decisions with before/after codes. Read + compute only: nothing is persisted, debited, or escalated. state=as_recorded — budget counters are held as the engine saw them, so cascade effects are not modeled. Owner-only.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id", "policy"],
                properties: {
                  wallet_id: { type: "string" },
                  from: { type: "string", format: "date" },
                  to: { type: "string", format: "date" },
                  policy: { $ref: "#/components/schemas/SimulatePolicyCandidate" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Simulation report",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    wallet_id: { type: "string" },
                    from: { type: "string", format: "date" },
                    to: { type: "string", format: "date" },
                    state: { type: "string", enum: ["as_recorded"], description: "Honesty envelope: counters held as the engine saw them; cascade effects not modeled." },
                    note: { type: "string" },
                    applied_fields: { type: "array", items: { type: "string" } },
                    ignored_fields: { type: "array", items: { type: "string" }, description: "Provided candidate fields the simulation cannot honor." },
                    totals: {
                      type: "object",
                      properties: {
                        was: { $ref: "#/components/schemas/SimulateEffectCounts" },
                        would: { $ref: "#/components/schemas/SimulateEffectCounts" },
                      },
                    },
                    approved_spend_usd: {
                      type: "object",
                      properties: { was: { type: "number" }, would: { type: "number" } },
                    },
                    counts: {
                      type: "object",
                      properties: {
                        considered: { type: "integer" },
                        simulated: { type: "integer" },
                        changed: { type: "integer" },
                        out_of_scope: { type: "integer" },
                        unreplayable: { type: "integer" },
                      },
                    },
                    changes: {
                      type: "array",
                      description: "Flipped decisions (first 100).",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          at: { type: "string", format: "date-time" },
                          agent: { type: "string" },
                          ladder: { type: "string", enum: ["spend", "capability"] },
                          action: { type: "string" },
                          merchant: { type: "string" },
                          amount_usd: { type: "number" },
                          final_status: { type: "string", description: "What actually happened, incl. human approvals." },
                          was: { $ref: "#/components/schemas/SimulateOutcome" },
                          would: { $ref: "#/components/schemas/SimulateOutcome" },
                        },
                      },
                    },
                    truncated: { type: "boolean" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid range, malformed body, or no simulatable fields provided" },
          "401": { description: "Management key required" },
        },
      },
    },
    "/authorize/{id}": {
      get: {
        operationId: "getAuthorizationRequest",
        summary: "Poll an escalated decision (grant receipt included)",
        description:
          "Read the current state of an authorization request by id — used to poll an escalation until a human resolves it. Readable by the wallet's agent key or the management key. On approval the response carries the one-use grant the agent redeems by retrying with grant_id. Settles expired escalations to the policy's timeout action on read.",
        security: [{ AgentApiKey: [] }, { ManagementKey: [] }],
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
          { in: "query", name: "wallet_id", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The request's status, decision, and (if approved) grant receipt" },
          "401": { description: "Wallet agent key or management key required" },
          "404": { description: "Request not found" },
        },
      },
    },
    "/approvals": {
      get: {
        operationId: "listApprovals",
        summary: "The approval inbox — pending escalations",
        description: "List the wallet's pending human-approval requests (spend, tool, provision, capability). Owner-only.",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Pending approvals" },
          "401": { description: "Management key required" },
        },
      },
      post: {
        operationId: "resolveApproval",
        summary: "Approve or reject a pending escalation",
        description: "Resolve a pending approval by approval_id or request_id. Approving mints a single-use, expiring grant the agent redeems on retry. Owner-only.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id", "decision"],
                properties: {
                  wallet_id: { type: "string" },
                  approval_id: { type: "string", description: "One of approval_id or request_id is required" },
                  request_id: { type: "string" },
                  decision: { type: "string", enum: ["approve", "reject"] },
                  note: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Resolved; approval returns the minted grant" },
          "400": { description: "Invalid request (neither approval_id nor request_id)" },
          "401": { description: "Management key required" },
        },
      },
    },
    "/credentials/vault": {
      post: {
        operationId: "storeCredential",
        summary: "Store an encrypted credential",
        description: "Envelope-encrypt and store a secret in the wallet's vault (AES-256-GCM, per-wallet DEK). Never returned raw — injected only under a scoped execution JWT with clearance ≥ the credential's bar. Owner-only.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id", "label", "type", "value"],
                properties: {
                  wallet_id: { type: "string" },
                  label: { type: "string", minLength: 1, maxLength: 64 },
                  type: { type: "string", enum: ["api_key", "oauth_token", "certificate", "license", "password"] },
                  value: { type: "string", minLength: 1, description: "The plaintext secret; stored encrypted, never returned" },
                  allowed_agent_ids: { type: "array", items: { type: "string" } },
                  scopes: { type: "array", items: { type: "string" } },
                  min_clearance: { type: "integer", minimum: 1, maximum: 5, default: 1 },
                  expires_at: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Stored (value returned as [encrypted])" },
          "400": { description: "Invalid request" },
          "401": { description: "Management key required" },
        },
      },
    },
    "/wallets/keys/rotate": {
      post: {
        operationId: "rotateWalletKey",
        summary: "Rotate the wallet's data-encryption key",
        description: "Rotate the per-wallet DEK; existing credentials are re-wrapped under the new key version. Owner-only.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["wallet_id"], properties: { wallet_id: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Rotated; returns the new key version" },
          "401": { description: "Management key required" },
        },
      },
    },
    "/webhooks": {
      get: {
        operationId: "listWebhooks",
        summary: "List notification routes",
        description: "List the wallet's registered webhook routes (secrets are not returned). Owner-only.",
        security: [{ ManagementKey: [] }],
        parameters: [{ in: "query", name: "wallet_id", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Webhook routes" }, "401": { description: "Management key required" } },
      },
      post: {
        operationId: "registerWebhook",
        summary: "Register a notification route (per-event subscriptions)",
        description: "Register a public https endpoint (or a Slack incoming-webhook URL) to receive events. Deliveries are HMAC-SHA256 signed; the signing secret is shown once at creation. Loopback / private / metadata hosts are rejected. Owner-only.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id", "url"],
                properties: {
                  wallet_id: { type: "string" },
                  url: { type: "string", format: "uri", description: "Public https endpoint or hooks.slack.com URL" },
                  events: { type: "array", items: { type: "string" }, description: "Subscribed events; defaults applied if omitted. '*' subscribes to all." },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Registered; signing secret returned once" },
          "400": { description: "Invalid or non-public URL" },
          "401": { description: "Management key required" },
        },
      },
    },
    "/reporting/daily-summary": {
      get: {
        operationId: "getDailySummary",
        summary: "One-day rollup",
        description: "The single-day counterpart to /reporting/summary: totals for spend, decisions, tokens, and secret access on one UTC date (defaults to today). Membership-gated — wallet owner or any wallet agent.",
        security: [{ AgentApiKey: [] }, { ManagementKey: [] }],
        parameters: [
          { in: "query", name: "wallet_id", required: true, schema: { type: "string" } },
          { in: "query", name: "date", schema: { type: "string", format: "date" } },
        ],
        responses: {
          "200": { description: "One-day totals" },
          "400": { description: "Invalid date (must be YYYY-MM-DD)" },
          "401": { description: "Management key or wallet agent key required" },
        },
      },
    },
    "/outcomes": {
      post: {
        operationId: "recordOutcome",
        summary: "Record a business outcome (CPO-1)",
        description:
          "Report a confirmed business result (an enrollment, booking, signed engagement) against this wallet. Sanction computes cost-per-outcome over a rolling window; when the wallet policy sets a cost_per_outcome ceiling, spend throttles to human-gated once the ceiling is crossed. Use dedupe_key so retries never double-count.",
        security: [{ AgentApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["kind"],
                properties: {
                  kind: { type: "string", description: "Outcome kind, lowercase — e.g. 'enrollment'. Must match policy outcome_kind for ceiling governance." },
                  value_usd: { type: "number", description: "Optional value of the outcome (reporting only)" },
                  play: { type: "string", description: "Optional campaign/play label" },
                  dedupe_key: { type: "string", description: "Idempotency key unique per outcome (e.g. CRM record id)" },
                  occurred_at: { type: "string", format: "date-time" },
                  metadata: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Outcome recorded" },
          "200": { description: "Duplicate dedupe_key — original outcome returned, not double-counted" },
          "401": { description: "Invalid API key" },
        },
      },
      get: {
        operationId: "getOutcomeSummary",
        summary: "Windowed cost-per-outcome summary",
        description: "Owner-only: outcomes, windowed spend, cost per outcome, and ceiling comparison for a wallet.",
        security: [{ ManagementKey: [] }],
        parameters: [
          { name: "wallet_id", in: "query", required: true, schema: { type: "string" } },
          { name: "kind", in: "query", required: true, schema: { type: "string" } },
          { name: "window_days", in: "query", schema: { type: "integer", default: 30 } },
        ],
        responses: {
          "200": { description: "Summary with outcomes, window_spend_usd, cost_per_outcome_usd, ceiling_usd, over_ceiling" },
          "401": { description: "Invalid management key" },
        },
      },
    },
    "/wallets/freeze": {
      post: {
        operationId: "freezeWallet",
        summary: "Freeze a wallet (kill-switch)",
        description:
          "Owner-only: pause every data-plane action for this wallet AND its entire subtree — spend, tools, provisioning, capabilities, execution tokens, token logging, and the LLM gateway all deny with WALLET_FROZEN until unfrozen. Nothing is deleted; unfreezing resumes exactly where the fleet stopped.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id"],
                properties: { wallet_id: { type: "string" }, reason: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Wallet frozen" }, "401": { description: "Invalid management key" } },
      },
    },
    "/wallets/unfreeze": {
      post: {
        operationId: "unfreezeWallet",
        summary: "Unfreeze a wallet",
        description: "Owner-only: lift this wallet's freeze. A frozen ancestor still blocks the subtree.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["wallet_id"], properties: { wallet_id: { type: "string" } } },
            },
          },
        },
        responses: { "200": { description: "Wallet unfrozen" }, "401": { description: "Invalid management key" } },
      },
    },
    "/wallets/reallocate": {
      post: {
        operationId: "reallocateBudget",
        summary: "Move budget between pools",
        description:
          "Owner-only: move subtree daily cap between two pools in your wallet subtree — the hook a learning layer or a human uses to shift budget toward the efficient channel. Both cap changes are policy-revisioned; the move is recorded as one auditable reallocation event.",
        security: [{ ManagementKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id", "from_wallet_id", "to_wallet_id", "amount_usd"],
                properties: {
                  wallet_id: { type: "string", description: "Your wallet (authorization root)" },
                  from_wallet_id: { type: "string" },
                  to_wallet_id: { type: "string" },
                  amount_usd: { type: "number" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Budget moved; response carries both pools' new caps and the reallocation id" },
          "401": { description: "Invalid management key" },
          "403": { description: "A pool is outside your wallet subtree" },
          "422": { description: "Source pool has no cap or insufficient cap" },
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
        description: "Create an agent under a wallet and receive its API key once. Accepts seat fields: holder (who holds it) and expires_at (contractor auto-shutoff — the key fails closed past that instant). Management-plane (x-mgmt-key).",
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
        summary: "List a wallet's agents (seats)",
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
        description: "Override budgets per agent (null clears to inherit the wallet policy), set clearance, revoke/reactivate with { active }, or set seat fields: holder (null clears) and expires_at (null clears the auto-shutoff). Management-plane.",
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
        description: "Issue a fresh key for an agent; the old key stops working immediately and the new key is shown once. Pass holder to hand the seat to a new person in the same motion — history, budgets, and clearance stay with the seat. To revoke without re-issuing, PATCH /agents with { active: false }. Management-plane (SEC-6).",
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
    "/agents/batch": {
      post: {
        operationId: "batchCreateSeats",
        summary: "Create N seats from one template",
        description:
          "Seat wallets: stamp one template (budgets, clearance, expiry) across up to 50 seats in a single call — e.g. five engineering seats at $20/day expiring end of quarter. Provide seats[] (names + optional holders) or name_prefix + count. Each seat's API key is shown once; only hashes are stored. Management-plane.",
        security: [{ ManagementKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BatchSeatsRequest" } } } },
        responses: {
          "201": { description: "Seats created; each api_key shown once", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchSeatsResponse" } } } },
          "400": { description: "Invalid request (missing roster, or over the 50-seat cap)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Missing or invalid management key" },
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
        summary: "Update budgets, subtree caps, thresholds, and categories",
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
