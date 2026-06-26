import { defineMcpClientConnection } from "eve/connections";

// Per-subagent copy — eve subagents inherit no connections from the root.
export default defineMcpClientConnection({
  url: process.env.SANCTION_MCP_URL ?? "http://127.0.0.1:8808/mcp",
  description:
    "Sanction governance. Call sanction__sanction_log_tokens after every LLM call, " +
    "and sanction__sanction_wallet_status to check budget headroom. Stop on budget errors.",
});
