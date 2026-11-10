import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { requireSanctionApiKey } from "@/agent/lib/sanction-key"

const execFileAsync = promisify(execFile)
const SHIPPED_TOOLS = [
  "sanction_authorize",
  "sanction_authorize_provision",
  "sanction_authorize_tool",
  "sanction_authorize_capability",
  "sanction_log_tokens",
  "sanction_log_outcome",
  "sanction_request_execution",
  "sanction_inject_credential",
  "sanction_wallet_status",
  "sanction_check_authorization",
] as const

describe("eve MCP agent key", () => {
  it("returns a pxy_ agent key from SANCTION_API_KEY", () => {
    expect(requireSanctionApiKey("  pxy_test_fixture  ")).toBe("pxy_test_fixture")
  })

  it.each([undefined, "", "   ", "sk_management", "pxy_one\npxy_two"])(
    "fails closed without echoing the value for %j",
    value => {
      expect(() => requireSanctionApiKey(value)).toThrow(/SANCTION_API_KEY/)
      try {
        requireSanctionApiKey(value)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        expect(message).not.toMatch(/sk_management|pxy_one|pxy_two/)
      }
    },
  )

  it("does not hardcode an agent key in the connection source", () => {
    const source = readFileSync("agent/connections/sanction.ts", "utf8")
    expect(source).toContain("requireSanctionApiKey")
    expect(source).toContain('"x-api-key"')
    expect(source).not.toMatch(/pxy_[A-Za-z0-9]+/)
  })
})

describe("eve first-setup instructions", () => {
  const instructions = readFileSync("agent/instructions.md", "utf8")

  it("names only shipped MCP tools and marks roster/seat-plan as future", () => {
    for (const tool of SHIPPED_TOOLS) {
      expect(instructions).toContain(tool)
    }
    expect(instructions).toMatch(/not on the shipped MCP server/i)
    expect(instructions).toMatch(/future work/i)
    expect(instructions).not.toMatch(/offer to scan the organization/i)
    expect(instructions).not.toMatch(/preview a deterministic seat plan/i)
  })
})

describe("eve-build script", () => {
  it("skips when VERCEL=1 so next build owns the Vercel output", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/eve-build.mjs"], {
      env: { ...process.env, VERCEL: "1" },
    })
    expect(stdout).toMatch(/skipped/)
    expect(stdout).toMatch(/VERCEL=1/)
  })
})
