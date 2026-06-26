import { defineMcpClientConnection } from "eve/connections";

// eve speaks remote MCP only (Streamable HTTP / SSE), but the published
// `sanction-mcp` is a stdio server. scripts/start-bridge.sh wraps it with
// supergateway and exposes it at the URL below. Tools arrive namespaced as
// `sanction__<tool>` — e.g. sanction__sanction_authorize.
//
// NOTE: eve subagents inherit nothing from the root, so this file is copied
// into each subagent's own connections/ directory.
export default defineMcpClientConnection({
  url: process.env.SANCTION_MCP_URL ?? "http://127.0.0.1:8808/mcp",
  description:
    "Sanction — agent wallet, credential vault, and governance layer. " +
    "Call sanction__sanction_authorize BEFORE any spend; sanction__sanction_log_tokens AFTER every LLM call; " +
    "sanction__sanction_request_execution then sanction__sanction_inject_credential for secrets; " +
    "sanction__sanction_wallet_status to check budget headroom.",
});
