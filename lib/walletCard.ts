/**
 * The platform Wallet Card — discovery metadata for the agent wallet, the way
 * an A2A Agent Card is discovery metadata for an agent.
 *
 * Public by design: names endpoints, transports, and honesty about enforcement.
 * Never includes keys. Per-agent cards (this wallet, this remaining budget band)
 * are a later slice; this document is the issuer's card.
 */

import { MCP_SERVER_VERSION } from "@/lib/mcpServer"

export const MCP_WALLET_TOOLS = [
  { name: "sanction_authorize", description: "Ask before any purchase, subscription, or transfer." },
  { name: "sanction_authorize_provision", description: "Ask before provisioning seats, licenses, or infrastructure." },
  { name: "sanction_authorize_tool", description: "Ask before invoking another tool, shell command, deploy, or send." },
  { name: "sanction_authorize_capability", description: "Ask before acquiring a skill, plugin, or new API." },
  { name: "sanction_check_authorization", description: "Poll an escalated request for its one-use grant." },
  { name: "sanction_log_tokens", description: "Record LLM token usage against the wallet's budgets." },
  { name: "sanction_log_outcome", description: "Record a confirmed business outcome for cost-per-outcome ceilings." },
  { name: "sanction_request_execution", description: "Mint a short-lived mandate (execution JWT) for a child agent or counterparty." },
  { name: "sanction_inject_credential", description: "Retrieve a vaulted secret under that mandate. Audit-logged." },
  { name: "sanction_wallet_status", description: "Today and month-to-date spend, token cost, and pending approvals." },
] as const

export type WalletCard = {
  name: string
  type: "agent-wallet"
  display_name: string
  description: string
  version: string
  homepage: string
  carry: {
    mcp_stdio: { command: string; args: string[]; package: string }
    mcp_remote: string
    mcp_broker: { url_template: string; register: string; note: string }
    rest: string
  }
  present: {
    mandate: string
    format: "execution-jwt"
    alg: "HS256"
    issuer: "sanction"
  }
  verify: {
    mandate: string
  }
  evidence: {
    export: string
    verify: string
  }
  tools: readonly { name: string; description: string }[]
  honesty: {
    enforcement: "cooperative+broker"
    interception: "gateway+mcp-broker"
    note: string
  }
}

export function walletCard(origin: string): WalletCard {
  const api = `${origin}/api/v1`
  return {
    name: "sanction",
    type: "agent-wallet",
    display_name: "Sanction — Agent Wallet",
    description:
      "The wallet an AI agent carries. Policy, budget, clearance, and evidence travel with the agent. Counterparties verify a mandate here before they work, sell, or settle.",
    version: MCP_SERVER_VERSION,
    homepage: "https://getsanction.com",
    carry: {
      mcp_stdio: { command: "npx", args: ["sanction-mcp"], package: "sanction-mcp" },
      mcp_remote: `${origin}/mcp`,
      mcp_broker: {
        url_template: `${origin}/mcp/broker/{upstream}`,
        register: `${api}/broker/upstreams`,
        note: "Point the host at the broker instead of the upstream MCP server: every tools/call is authorized by the wallet's policy before it is forwarded, and the upstream credential lives in the wallet's vault, never with the agent.",
      },
      rest: api,
    },
    present: {
      mandate: `${api}/exec`,
      format: "execution-jwt",
      alg: "HS256",
      issuer: "sanction",
    },
    verify: {
      mandate: `${api}/mandate/verify`,
    },
    evidence: {
      export: `${api}/audit/export`,
      verify: `${api}/audit/verify`,
    },
    tools: MCP_WALLET_TOOLS,
    honesty: {
      enforcement: "cooperative+broker",
      interception: "gateway+mcp-broker",
      note:
        "Two enforcement modes, named precisely. INTERCEPTED: the LLM gateway (inference spend) and the MCP broker (`/mcp/broker/{upstream}` — tools/call is authorized before it is forwarded, so on brokered traffic a hijacked agent cannot invoke what policy forbids). COOPERATIVE: stdio MCP and the hosted wallet URL (`/mcp`) — the host must call Sanction before acting. Traffic that goes straight to an upstream without the broker is not governed; route it through the broker if it must be.",
    },
  }
}
