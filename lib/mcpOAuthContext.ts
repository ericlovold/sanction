import { AsyncLocalStorage } from "node:async_hooks"

export type McpOAuthConsentContext = { connectionId: string; userId: string }

// Set only by the server-side consent action after validating the human and
// selected agent. Request-local state prevents concurrent browser flows from
// changing the identity pinned into another authorization code.
export const mcpOAuthConsentContext = new AsyncLocalStorage<McpOAuthConsentContext>()
