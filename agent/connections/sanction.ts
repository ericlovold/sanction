import { defineMcpClientConnection } from "eve/connections"

export default defineMcpClientConnection({
  url: process.env.SANCTION_MCP_URL ?? "https://getsanction.com/mcp",
  description: "Sanction governance: submit organization rosters, preview seat plans, and apply approved plans through the wallet approval loop.",
})
