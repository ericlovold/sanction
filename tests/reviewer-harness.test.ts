import { describe, expect, it, vi } from "vitest"
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runReviewerEvidence, validateLoopbackApiUrl } from "../scripts/reviewer/harness"

describe("reviewer evidence safety boundaries", () => {
  it.each([
    "https://getsanction.com/api/v1",
    "http://example.com/api/v1",
    "http://localhost.example.com/api/v1",
    "http://user:password@127.0.0.1:3167/api/v1",
    "http://127.0.0.1:3167/api/v1?forward=production",
    "http://127.0.0.1:3167/api/v1#fragment",
  ])("rejects unsafe target %s before any request", async (apiUrl) => {
    const fetchImpl = vi.fn()
    expect(() => validateLoopbackApiUrl(apiUrl)).toThrow()
    await expect(runReviewerEvidence({ apiUrl, fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("accepts an explicit loopback API target", () => {
    expect(validateLoopbackApiUrl("http://127.0.0.1:3167/api/v1")).toBe("http://127.0.0.1:3167/api/v1")
  })

  it("does not expose a backend error body or fabricate passing cases", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: "pxy_do_not_leak", management_key: "sk_do_not_leak", email: "owner@example.invalid",
    }), { status: 500 }))
    const report = await runReviewerEvidence({ apiUrl: "http://127.0.0.1:3167/api/v1", fetchImpl })
    expect(report.overall).toBe("failed")
    expect(report.evidence_scope).toBe("backend_only")
    expect(JSON.stringify(report)).not.toMatch(/do_not_leak|owner@example/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ redirect: "error" })]))
  })

  it("redacts transport failures and never retries an ambiguous fixture write", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("sk_transport_secret pxy_transport_secret"))
    const report = await runReviewerEvidence({ apiUrl: "http://127.0.0.1:3167/api/v1", fetchImpl })
    expect(report.overall).toBe("failed")
    expect(JSON.stringify(report)).not.toContain("transport_secret")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("rejects a malformed successful fixture response", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }))
    const report = await runReviewerEvidence({ apiUrl: "http://127.0.0.1:3167/api/v1", fetchImpl })
    expect(report.overall).toBe("failed")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("fails the first case if explicit review is silently allowed and stops subsequent cases", async () => {
    let wallets = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      const body = JSON.parse(String(init?.body ?? "{}"))
      let result: unknown
      if (path.endsWith("/wallets")) result = { id: `fixture-${++wallets}`, name: body.name, parent_id: null, management_key: "sk_test_only" }
      else if (path.endsWith("/wallets/policy")) {
        const { wallet_id, ...policy } = body
        result = { wallet_id, policy }
      } else if (path.endsWith("/agents")) result = { id: "agent", wallet_id: body.wallet_id, name: body.name, api_key: "pxy_test_only" }
      else if (path.endsWith("/authorize/tool")) result = { authorized: true, status: "allowed", reason: "sensitive_reason_should_not_leak" }
      else throw new Error("Unexpected API call")
      return new Response(JSON.stringify(result), { status: 200 })
    })
    const report = await runReviewerEvidence({ apiUrl: "http://127.0.0.1:3167/api/v1", fetchImpl })
    expect(report.overall).toBe("failed")
    expect(report.cases[0]).toMatchObject({ id: "positive_1", status: "failed", failure_code: "UNEXPECTED_DECISION" })
    expect(report.cases.slice(1).every((c) => c.status === "not_run")).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(10)
    expect(JSON.stringify(report)).not.toMatch(/sk_test_only|pxy_test_only|sensitive_reason/)
  })

  it("CLI refuses an existing report before contacting the fixture API", async () => {
    let requests = 0
    const server = createServer((_req, res) => { requests++; res.writeHead(503); res.end("{}"); })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const dir = await mkdtemp(join(tmpdir(), "sanction-review-cli-"))
    const output = join(dir, "evidence.json")
    try {
      await writeFile(output, "existing evidence")
      const { port } = server.address() as { port: number }
      const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/reviewer/run.ts",
        "--api-url", `http://127.0.0.1:${port}/api/v1`, "--output", output], { timeout: 15000 })
        .then(() => ({ code: 0, stderr: "" }), (error) => ({ code: error.code, stderr: error.stderr }))
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Reviewer harness stopped: CLI_FAILED")
      expect(result.stderr).not.toContain("Transform failed")
      expect(requests).toBe(0)
      expect(await readFile(output, "utf8")).toBe("existing evidence")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  }, 20000)
})
