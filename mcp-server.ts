#!/usr/bin/env node
/**
 * Sanction MCP — stdio entrypoint. The wallet an AI agent carries.
 *
 * Tool surface lives in lib/mcpServer.ts (shared with the hosted /mcp URL).
 * stdio is cooperative: the host must ask before acting.
 *
 * Configuration (env vars):
 *   SANCTION_API_URL   — Sanction API base URL (default: https://getsanction.com/api/v1)
 *   SANCTION_API_KEY   — Agent API key (pxy_...)
 *   SANCTION_WALLET_ID — Optional; wallet ID for status queries. When unset,
 *                        status derives the wallet from the agent key.
 *
 * Usage:
 *   npx sanction-mcp
 *   node mcp-server.js
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { realpathSync } from "fs"
import { pathToFileURL } from "url"
import { createSanctionMcpServer } from "./lib/mcpServer"

const API_URL = process.env.SANCTION_API_URL ?? "https://getsanction.com/api/v1"
const API_KEY = process.env.SANCTION_API_KEY ?? ""
const WALLET_ID = process.env.SANCTION_WALLET_ID ?? ""

const MISSING_KEY = [
  "",
  "Sanction MCP — SANCTION_API_KEY is not set.",
  "",
  "This server is started by your MCP host (Claude Desktop, agent runtimes),",
  "not run directly. Add it to your host config with your keys:",
  "",
  '  "sanction": {',
  '    "command": "npx",',
  '    "args": ["sanction-mcp"],',
  '    "env": { "SANCTION_API_KEY": "pxy_..." }',
  "  }",
  "",
  "Or run it directly to test:",
  "  SANCTION_API_KEY=pxy_... npx sanction-mcp",
  "",
  "No keys yet? Create a wallet free at https://getsanction.com/start",
  "",
].join("\n")

// Constructed at import so conformance tests can inspect the tool surface
// without a transport. Hosted /mcp builds a fresh instance per request.
export const server = createSanctionMcpServer({
  apiKey: API_KEY || "pxy_unconfigured",
  apiUrl: API_URL,
  walletId: WALLET_ID || undefined,
})

async function main() {
  if (!API_KEY) {
    process.stderr.write(MISSING_KEY + "\n")
    process.exit(1)
  }
  await server.connect(new StdioServerTransport())
}

// Hosts launch this through npm's bin shim, which is a SYMLINK
// (node_modules/.bin/sanction-mcp → packages/sanction-mcp/mcp-server.js).
// `process.argv[1]` is then the symlink path while `import.meta.url` is the
// resolved real path, so a naive comparison silently fails to start the server
// — the process would exit 0 having served nothing. Resolve before comparing,
// and fall back to running: for a bin whose only job is to serve stdio, a
// false negative (dead server, no output) is far worse than a false positive.
function isEntrypoint(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  await main()
}
