import { afterEach, describe, expect, it, vi } from "vitest"
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkPulseFixtures } from "../scripts/demo/preflight"
import { meridian } from "../scripts/demo/personas/meridian"
import type { Keys } from "../scripts/demo/lib"

const day = "2026-10-02"
const now = () => new Date(`${day}T12:00:00Z`)
const keys: Keys = {
  company: { walletId: "company", mgmtKey: "test-owner" },
  pools: { engineering: { walletId: "pool", mgmtKey: "test-owner" } },
  seats: Object.fromEntries([...new Set(meridian.pulse.tokens.map((t) => t.seat))]
    .map((name) => [name, { agentId: name, apiKey: "test-agent", poolName: "engineering" }])),
  pending: [{ requestId: "preserve-this", seat: "ci-agent", kind: "tool", retry: {} }],
}
const report = (cost = 0, date = day) => ({
  wallet_id: "pool", scope: "wallet", from: date, to: date,
  by_agent: Object.keys(keys.seats).map((id) => ({ agent_id: id, token_cost_usd: cost })),
})
function respond(body: unknown, status = 200) {
  return vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })))
}
afterEach(() => vi.unstubAllGlobals())

describe("pulse fixture guard", () => {
  it("reads each pool once with owner authentication and preserves pending state", async () => {
    respond(report())
    const before = structuredClone(keys)
    expect(await checkPulseFixtures(meridian, keys, now)).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/reporting/summary?"), expect.objectContaining({
      method: "GET", headers: { "content-type": "application/json", "x-mgmt-key": "test-owner" },
      body: undefined,
    }))
    expect(keys).toEqual(before)
  })
  it("blocks even small prior usage instead of treating it as available budget", async () => {
    respond(report(0.01))
    expect(await checkPulseFixtures(meridian, keys, now)).toContain("ci-agent: already logged $0.01 on 2026-10-02 UTC; fixture is not fresh")
  })
  it.each([
    null, {}, { ...report(), truncated: true }, { ...report(), scope: "subtree" },
    { ...report(), wallet_id: "wrong" }, { ...report(), from: "2026-10-01" },
    { ...report(), by_agent: [] },
    { ...report(), by_agent: [...report().by_agent, report().by_agent[0]] },
    { ...report(), by_agent: [{ agent_id: "ci-agent", token_cost_usd: -1 }] },
    { ...report(), by_agent: [{ agent_id: "ci-agent", token_cost_usd: "0" }] },
  ])("fails closed on incomplete or malformed reporting: %j", async (body) => {
    respond(body)
    expect((await checkPulseFixtures(meridian, keys, now)).length).toBeGreaterThan(0)
  })
  it("does not interpret an HTTP error as zero usage", async () => {
    respond(report(), 401)
    expect((await checkPulseFixtures(meridian, keys, now))[0]).toContain("HTTP 401")
  })
  it("redacts transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sensitive-header-value")))
    const errors = await checkPulseFixtures(meridian, keys, now)
    expect(errors).toEqual(["engineering: fixture report request failed"])
  })
  it("rejects snapshots crossing UTC midnight", async () => {
    respond(report())
    const clock = vi.fn().mockReturnValueOnce(now()).mockReturnValueOnce(new Date("2026-10-03T00:00:00Z"))
    expect(await checkPulseFixtures(meridian, keys, clock)).toContain("UTC date changed during preflight; run again")
  })
  it.each(["used", "unavailable"])("actual pulse CLI makes zero writes with %s fixtures", async (state) => {
    const requests: string[] = []
    const server = createServer((req, res) => {
      requests.push(req.method ?? "")
      const date = new URL(req.url!, "http://localhost").searchParams.get("from")!
      res.writeHead(state === "used" ? 200 : 503, { "content-type": "application/json" })
      res.end(JSON.stringify(state === "used" ? report(9.6, date) : { error: "unavailable" }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const dir = await mkdtemp(join(tmpdir(), "sanction-pulse-test-"))
    const file = join(dir, ".keys.meridian.json")
    const original = JSON.stringify(keys)
    try {
      await writeFile(file, original)
      const address = server.address() as { port: number }
      const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/demo/run.ts", "pulse", "meridian"], {
        cwd: process.cwd(), timeout: 15000,
        env: { ...process.env, DEMO_KEYS_DIR: dir, SANCTION_API_URL: `http://127.0.0.1:${address.port}/api/v1` },
      }).then(() => ({ code: 0, stderr: "" }), (error) => ({ code: error.code, stderr: error.stderr }))
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("preflight failed before writes")
      expect(requests).toEqual(["GET"])
      expect(await readFile(file, "utf8")).toBe(original)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  }, 20000)
})

describe("Demo Pulse workflow aggregation", () => {
  it.each(["none", "meridian", "coastline", "harborwren", "all"])("runs every persona when %s fails", async (failure) => {
    const workflow = await readFile(".github/workflows/demo-pulse.yml", "utf8")
    const script = workflow.slice(workflow.indexOf("          set -e\n")).replace(/^ {10}/gm, "")
    const dir = await mkdtemp(join(tmpdir(), "sanction-pulse-loop-"))
    try {
      const stub = join(dir, "npx")
      await writeFile(stub, '#!/bin/bash\np="${@: -1}"\nprintf "%s\\n" "$p" >> "$PULSE_TEST_LOG"\nif [[ "$PULSE_TEST_FAIL" == "$p" || "$PULSE_TEST_FAIL" == all ]]; then exit 7; fi\n')
      await chmod(stub, 0o700)
      const summary = join(dir, "summary")
      const log = join(dir, "log")
      const code = await promisify(execFile)("bash", ["-e", "-o", "pipefail", "-c", script], {
        timeout: 5000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, PULSE_TEST_LOG: log, PULSE_TEST_FAIL: failure },
      }).then(() => 0, (error) => error.code)
      expect(code).toBe(failure === "none" ? 0 : 1)
      expect(await readFile(log, "utf8")).toBe("meridian\ncoastline\nharborwren\n")
      const results = await readFile(summary, "utf8")
      for (const persona of ["meridian", "coastline", "harborwren"]) {
        expect(results).toContain(`| ${persona} | ${failure === "all" || failure === persona ? "Failed | 7" : "Passed | 0"} |`)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
