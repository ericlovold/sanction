import { defineMcpClientConnection } from "eve/connections"
import { requireSanctionApiKey } from "../lib/sanction-key"

export default defineMcpClientConnection({
  url: process.env.SANCTION_MCP_URL ?? "https://getsanction.com/mcp",
  description:
    "Sanction authorization plane: ask before spend, tool use, credentials, provisioning, or capabilities. " +
    "Use sanction_wallet_status for budget headroom; sanction_authorize, sanction_authorize_provision, " +
    "sanction_authorize_tool, and sanction_authorize_capability before acting; " +
    "sanction_check_authorization after an owner decides; sanction_log_tokens and sanction_log_outcome to record usage; " +
    "sanction_request_execution then sanction_inject_credential for vaulted secrets. " +
    "Roster scan and seat-plan tools are not on this server.",
  // Hosted MCP authenticates with x-api-key (or Bearer). Resolve at request
  // time so a missing key fails the connection clearly without breaking build.
  headers: () => ({
    "x-api-key": requireSanctionApiKey(),
  }),
})
