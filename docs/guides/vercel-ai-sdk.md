# Sanction + Vercel AI SDK Integration

Route LLM calls through Sanction's gateway and authorize spend actions before they happen.

> **Prerequisites:** A Sanction wallet and agent key (`pxy_...`). See the [Quickstart](./quickstart.md).

---

## 1. Install Dependencies

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai
```

## 2. Gateway Base-URL Swap

Point the provider SDK at Sanction's gateway instead of the provider directly. Pass your agent key in the `x-sanction-key` header.

```typescript
// sanction-provider.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

const SANCTION_KEY = process.env.SANCTION_AGENT_KEY!; // pxy_...

// Claude via Sanction gateway
export const claude = createAnthropic({
  baseURL: "https://getsanction.com/api/gateway/anthropic/v1",
  headers: { "x-sanction-key": SANCTION_KEY },
});

// OpenAI via Sanction gateway
export const openai = createOpenAI({
  baseURL: "https://getsanction.com/api/gateway/openai/v1",
  headers: { "x-sanction-key": SANCTION_KEY },
});
```

Every call through the gateway is automatically metered in your Sanction dashboard.

## 3. Pre-Spend Authorization Callback

Before your agent performs any financial action, call `POST /api/v1/authorize` and honor the result.

```typescript
// authorize.ts
type AuthResult = {
  authorized: boolean;
  status: "approved" | "denied" | "escalated" | "pending";
  reason?: string;
  code?: string;
  remediation?: string;
};

export async function authorize(params: {
  action: "purchase" | "subscribe" | "transfer";
  amount_usd: number;
  merchant: string;
  category: string;
  description?: string;
}): Promise<AuthResult> {
  const res = await fetch("https://getsanction.com/api/v1/authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.SANCTION_AGENT_KEY!,
    },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<AuthResult>;
}
```

## 4. Putting It Together

```typescript
// agent.ts
import { generateText } from "ai";
import { claude } from "./sanction-provider";
import { authorize } from "./authorize";

async function run() {
  // 1. LLM call routed through Sanction (auto-metered)
  const { text } = await generateText({
    model: claude("claude-sonnet-4-20250514"),
    prompt: "Recommend a CI/CD tool under $50/mo",
  });
  console.log("Recommendation:", text);

  // 2. Pre-spend authorization before acting
  const decision = await authorize({
    action: "subscribe",
    amount_usd: 29,
    merchant: "GitHub Actions",
    category: "software",
    description: "CI/CD subscription recommended by agent",
  });

  switch (decision.status) {
    case "approved":
      console.log("Approved -- proceeding with purchase");
      break;
    case "escalated":
      console.log("Escalated to human:", decision.reason);
      break;
    case "denied":
      console.log("Denied:", decision.reason, decision.remediation);
      break;
  }
}

run();
```

---

## Environment Variables

```bash
SANCTION_AGENT_KEY=pxy_live_...    # from POST /agents
ANTHROPIC_API_KEY=sk-ant-...       # your provider key (passed through gateway)
```

## Reference

- [OpenAPI spec](https://getsanction.com/api/openapi.json)
- [Quickstart](./quickstart.md)
