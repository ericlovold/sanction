#!/usr/bin/env node
/**
 * End-to-end MCP install smoke test:
 * 1. Missing-key guard
 * 2. Install deeplink payload shape (Cursor / VS Code)
 * 3. Local bundle stdio handshake + tools/list
 * 4. Published npx sanction-mcp stdio handshake + tools/list
 * 5. sanction_wallet_status against live API
 */
import { spawn } from "node:child_process"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const API = process.env.SANCTION_API_URL ?? "https://getsanction.com/api/v1"
const LOCAL_MCP = path.join(ROOT, "packages/sanction-mcp/mcp-server.js")

// The FULL tool surface. This list is the contract: the local bundle and the
// published npm package must BOTH serve exactly these. A stale registry
// package fails loudly here instead of shipping a governance product that
// cannot check authorizations (the 0.4.0 drift, found 2026-07-11).
const EXPECTED_TOOLS = [
  "sanction_authorize",
  "sanction_authorize_capability",
  "sanction_authorize_provision",
  "sanction_authorize_tool",
  "sanction_check_authorization",
  "sanction_inject_credential",
  "sanction_log_outcome",
  "sanction_log_tokens",
  "sanction_request_execution",
  "sanction_wallet_status",
]

let pass = 0
let fail = 0

function ok(label) {
  console.log(`  ✓ ${label}`)
  pass++
}

function bad(label, detail = "") {
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
  fail++
}

async function provision() {
  const w = await fetch(`${API}/wallets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "mcp-install-test", owner_email: `mcp-test+${Date.now()}@sanction.dev` }),
  }).then((r) => r.json())
  if (!w.id || !w.management_key) throw new Error(`wallet create failed: ${JSON.stringify(w)}`)

  const a = await fetch(`${API}/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mgmt-key": w.management_key },
    body: JSON.stringify({ wallet_id: w.id, name: "mcp-test-agent" }),
  }).then((r) => r.json())
  if (!a.api_key) throw new Error(`agent create failed: ${JSON.stringify(a)}`)

  return { walletId: w.id, apiKey: a.api_key }
}

function runMissingKey(command, args, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, SANCTION_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] })
    let err = ""
    child.stderr.on("data", (d) => { err += d })
    child.on("close", (code) => {
      if (code === 1 && err.includes("SANCTION_API_KEY is not set")) ok(`${label}: missing-key guard`)
      else bad(`${label}: missing-key guard`, `exit ${code}, stderr=${err.slice(0, 120)}`)
      resolve()
    })
  })
}

function installPayload(key, wallet) {
  const env = { SANCTION_API_KEY: key, SANCTION_WALLET_ID: wallet }
  const server = { command: "npx", args: ["-y", "sanction-mcp"], env }
  const b64 = Buffer.from(JSON.stringify(server), "utf8").toString("base64")
  const cursorDecoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
  return { server, cursorDecoded, b64, vscode: { name: "sanction", ...server } }
}

async function mcpHandshake({ command, args, env, label }) {
  const transport = new StdioClientTransport({ command, args, env, stderr: "pipe" })
  const client = new Client({ name: "mcp-install-test", version: "1.0.0" })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t))
    const extra = names.filter((t) => !EXPECTED_TOOLS.includes(t))
    if (missing.length) bad(`${label}: tools/list`, `missing ${missing.join(", ")} — if this is the npm package, publish the current bundle`)
    else if (extra.length) bad(`${label}: tools/list`, `unexpected ${extra.join(", ")} — update EXPECTED_TOOLS deliberately`)
    else ok(`${label}: tools/list (${names.length} tools, exact match)`)

    const status = await client.callTool({ name: "sanction_wallet_status", arguments: {} })
    const text = status.content?.[0]?.text ?? ""
    if (typeof text === "string" && text.includes("Today - tokens:")) ok(`${label}: sanction_wallet_status`)
    else bad(`${label}: sanction_wallet_status`, String(text).slice(0, 120))

    await client.close()
  } catch (e) {
    bad(`${label}: handshake`, e instanceof Error ? e.message : String(e))
    try { await client.close() } catch { /* */ }
  }
}

console.log("Sanction MCP install test\n")

// --- install deeplink shape ---
const payload = installPayload("pxy_test", "wlt_test")
if (payload.server.command === "npx" && payload.server.args.join(" ") === "-y sanction-mcp") ok("install payload: npx -y sanction-mcp")
else bad("install payload: npx -y sanction-mcp")
if (JSON.stringify(payload.cursorDecoded) === JSON.stringify(payload.server)) ok("install payload: Cursor base64 round-trip")
else bad("install payload: Cursor base64 round-trip")
if (payload.vscode.name === "sanction" && payload.vscode.env.SANCTION_API_KEY === "pxy_test") ok("install payload: VS Code shape")
else bad("install payload: VS Code shape")

// --- missing key ---
await runMissingKey("node", [LOCAL_MCP], "local bundle")
await runMissingKey("npx", ["-y", "sanction-mcp"], "npm package")

// --- live handshake ---
console.log("\nProvisioning throwaway wallet…")
let creds
try {
  creds = await provision()
  ok(`provisioned wallet ${creds.walletId.slice(0, 12)}…`)
} catch (e) {
  bad("provision wallet", e instanceof Error ? e.message : String(e))
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(1)
}

const env = {
  ...process.env,
  SANCTION_API_KEY: creds.apiKey,
  SANCTION_WALLET_ID: creds.walletId,
  SANCTION_API_URL: API,
}

console.log("\nMCP stdio handshake:")
await mcpHandshake({ command: "node", args: [LOCAL_MCP], env, label: "local bundle" })
await mcpHandshake({ command: "npx", args: ["-y", "sanction-mcp"], env, label: "npx sanction-mcp" })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
