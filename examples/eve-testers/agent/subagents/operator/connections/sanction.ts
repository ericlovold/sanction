import { defineMcpClientConnection } from "eve/connections";

// Per-subagent copy — eve subagents inherit no connections from the root.
export default defineMcpClientConnection({
  url: process.env.SANCTION_MCP_URL ?? "http://127.0.0.1:8808/mcp",
  description:
    "Sanction governance. Use sanction__sanction_request_execution to get a scoped " +
    "JWT, then sanction__sanction_inject_credential to read a secret. Request minimum scope.",
});
