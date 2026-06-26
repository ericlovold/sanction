import { defineMcpClientConnection } from "eve/connections";

// Per-subagent copy — eve subagents inherit no connections from the root.
export default defineMcpClientConnection({
  url: process.env.SANCTION_MCP_URL ?? "http://127.0.0.1:8808/mcp",
  description:
    "Sanction governance. Call sanction__sanction_authorize before ANY purchase, " +
    "subscription, or transfer. Never proceed if it returns authorized:false.",
});
