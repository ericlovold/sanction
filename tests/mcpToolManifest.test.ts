// The manifest must not drift from the real MCP server: every tool the server
// registers appears in the manifest (and vice versa), and every scenario
// references a manifest tool with args that fit its field specs.

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { MCP_TOOLS, SCENARIOS, SCENARIO_ENV_OVERRIDES } from "../lib/mcpToolManifest"

const serverSource = readFileSync(path.join(__dirname, "..", "mcp-server.ts"), "utf8")

const registeredTools = [...serverSource.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map((m) => m[1])

describe("mcp tool manifest", () => {
  it("covers exactly the tools mcp-server.ts registers", () => {
    expect(new Set(MCP_TOOLS.map((t) => t.name))).toEqual(new Set(registeredTools))
    expect(registeredTools).toHaveLength(10)
  })

  it("manifest required fields exist in the server schema source", () => {
    for (const tool of MCP_TOOLS) {
      for (const field of tool.fields) {
        expect(serverSource, `${tool.name}.${field.key} missing from mcp-server.ts`).toContain(`${field.key}:`)
      }
    }
  })

  it("every scenario references a known tool and only known fields", () => {
    const byName = new Map(MCP_TOOLS.map((t) => [t.name, t]))
    for (const s of SCENARIOS) {
      const tool = byName.get(s.tool)
      expect(tool, `scenario ${s.id} references unknown tool ${s.tool}`).toBeDefined()
      const fieldKeys = new Set(tool!.fields.map((f) => f.key))
      for (const key of Object.keys(s.args)) {
        expect(fieldKeys.has(key), `scenario ${s.id} arg ${key} not in ${s.tool} fields`).toBe(true)
      }
    }
  })

  it("scenarios cover every tool at least once", () => {
    const covered = new Set(SCENARIOS.map((s) => s.tool))
    for (const tool of MCP_TOOLS) {
      expect(covered.has(tool.name), `${tool.name} has no scenario`).toBe(true)
    }
  })

  it("env overrides only exist for the failure-mode scenarios and never leak secrets", () => {
    expect(Object.keys(SCENARIO_ENV_OVERRIDES).map(Number).sort()).toEqual([16, 17])
    for (const overrides of Object.values(SCENARIO_ENV_OVERRIDES)) {
      for (const [key, value] of Object.entries(overrides)) {
        expect(["SANCTION_API_KEY", "SANCTION_API_URL"]).toContain(key)
        expect(value).not.toMatch(/^pxy_(?!invalid)/) // never a real-looking key
      }
    }
  })

  it("required scenario args are present", () => {
    const byName = new Map(MCP_TOOLS.map((t) => [t.name, t]))
    for (const s of SCENARIOS) {
      const tool = byName.get(s.tool)!
      for (const f of tool.fields.filter((f) => f.required)) {
        expect(s.args[f.key], `scenario ${s.id} missing required ${s.tool}.${f.key}`).toBeDefined()
      }
    }
  })
})
