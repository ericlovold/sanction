// Dev-only MCP tester: the Next server acts as the MCP HOST so keys never reach
// the browser. Each call spins a fresh client — slow (~100ms spawn) but hermetic,
// which is what a test harness wants: no cross-call session state to un-confuse.
//
// Transport A (default): spawn the committed bundle packages/sanction-mcp/mcp-server.js
//   as a stdio child — no bridge required.
// Transport B: streamableHttp to SANCTION_MCP_URL (the supergateway bridge eve
//   uses; later, the hosted remote MCP) — exercises the remote path end-to-end.

import { NextRequest, NextResponse } from "next/server"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { MCP_TOOLS, SCENARIO_ENV_OVERRIDES } from "@/lib/mcpToolManifest"

export const runtime = "nodejs"

const KNOWN_TOOLS = new Set(MCP_TOOLS.map((t) => t.name))

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MCP_TESTER_ENABLED === "1"
}

type CallBody = {
  tool: string
  args?: Record<string, unknown>
  transport?: "stdio" | "http"
  // Only the allowlisted per-scenario overrides (bad key / dead URL) are honored —
  // a free-form env passthrough from the browser would be a credential exfil path.
  scenarioId?: number
}

export async function POST(req: NextRequest) {
  if (!enabled()) {
    return NextResponse.json({ error: "mcp-tester is disabled in production" }, { status: 404 })
  }
  let body: CallBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  if (!body.tool || !KNOWN_TOOLS.has(body.tool)) {
    return NextResponse.json({ error: `unknown tool ${body.tool ?? "(none)"}` }, { status: 400 })
  }

  const overrides = body.scenarioId ? (SCENARIO_ENV_OVERRIDES[body.scenarioId] ?? {}) : {}
  const started = Date.now()
  const client = new Client({ name: "sanction-mcp-tester", version: "0.1.0" })

  try {
    if (body.transport === "http") {
      const url = process.env.SANCTION_MCP_URL ?? "http://127.0.0.1:8808/mcp"
      await client.connect(new StreamableHTTPClientTransport(new URL(url)))
    } else {
      const serverPath = path.join(process.cwd(), "packages", "sanction-mcp", "mcp-server.js")
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [serverPath],
          env: {
            ...(process.env as Record<string, string>),
            SANCTION_API_KEY: process.env.SANCTION_API_KEY ?? "",
            ...overrides,
          },
          stderr: "pipe",
        }),
      )
    }

    const result = await client.callTool({ name: body.tool, arguments: body.args ?? {} })
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n")
    return NextResponse.json({
      ok: true,
      isError: result.isError === true,
      text,
      raw: result,
      latencyMs: Date.now() - started,
      transport: body.transport === "http" ? "http" : "stdio",
    })
  } catch (err) {
    // Host-level failure (couldn't start/reach the MCP server at all) — distinct
    // from the server's own fail-closed tool errors, and must read that way.
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, isError: true, text: `MCP host error: ${detail}`, latencyMs: Date.now() - started },
      { status: 502 },
    )
  } finally {
    await client.close().catch(() => {})
  }
}
