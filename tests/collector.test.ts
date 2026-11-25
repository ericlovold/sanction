// Local usage collector (packages/sanction-collector): parsers, discovery,
// rollup and the batch that leaves the device. Fixtures are synthetic, shaped
// like Claude Code 2.1.332 and Codex 0.172.0 files; CANARY strings mark
// content that must never reach a batch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseClaudeCode, claudeCodeSurface } from "../packages/sanction-collector/src/parsers/claudeCode"
import { parseCodex, codexSurface } from "../packages/sanction-collector/src/parsers/codex"
import { emptyHealth, noteVersion } from "../packages/sanction-collector/src/parsers/health"
import { claudeCodeRoots, codexRoots, findClaudeCode, findCodex, readLines } from "../packages/sanction-collector/src/discover"
import { rollupPlanWindows, rollupRecords, sessionRef } from "../packages/sanction-collector/src/rollup"
import { buildBatch, batchHeaders, encodeBatch, generateDeviceKey, signBody, BATCH_SCHEMA } from "../packages/sanction-collector/src/batch"
import { scan } from "../packages/sanction-collector/src/scan"
import { main } from "../packages/sanction-collector/src/cli"
import { isoTime, label, modelName, opaqueId, tokens, versionString } from "../packages/sanction-collector/src/record"
import { verifyCollectorSignature } from "../lib/collectorBatch"

const FIX = join(__dirname, "fixtures/collector")
const lines = (name: string) => readFileSync(join(FIX, name), "utf8").split("\n")

const CLAUDE_SESSION = "6f1c2b9e-1111-4aaa-8bbb-00000000000a"
const CODEX_SESSION = "019a0b1c-2222-7ccc-8ddd-00000000000b"
const LEGACY_SESSION = "019a0b1c-3333-7eee-8fff-00000000000c"

describe("record validators", () => {
  it("accept only the narrow shapes a usage field can have", () => {
    expect(modelName("claude-sonnet-5-5")).toBe("claude-sonnet-5-5")
    expect(modelName("us.anthropic.claude-sonnet-5-5:0")).toBe("us.anthropic.claude-sonnet-5-5:0")
    expect(modelName("<synthetic>")).toBeNull()
    expect(modelName("a model with spaces")).toBeNull()
    expect(modelName(42)).toBeNull()
    expect(opaqueId(CLAUDE_SESSION)).toBe(CLAUDE_SESSION)
    expect(opaqueId("/Users/canary")).toBeNull()
    expect(opaqueId("short")).toBeNull()
    expect(versionString("2.1.332")).toBe("2.1.332")
    expect(versionString("v2")).toBeNull()
    expect(label("codex")).toBe("codex")
    expect(label("Codex Plan")).toBeNull()
    expect(tokens(12)).toBe(12)
    expect(tokens(-1)).toBe(0)
    expect(tokens(1.5)).toBe(0)
    expect(tokens("12")).toBe(0)
    expect(isoTime("2026-11-20T10:15:00.000Z")?.toISOString()).toBe("2026-11-20T10:15:00.000Z")
    expect(isoTime("not a date")).toBeNull()
    expect(isoTime("x".repeat(41))).toBeNull()
  })

  it("health keeps at most 20 distinct tool versions", () => {
    const h = emptyHealth("test/parser@1")
    for (let i = 0; i < 30; i++) noteVersion(h, `1.0.${i % 25}`)
    noteVersion(h, null)
    expect(h.toolVersions).toHaveLength(20)
  })
})

describe("Claude Code transcript parser", () => {
  const { records, health } = parseClaudeCode([lines("claude-session.jsonl"), lines("claude-subagent.jsonl")])
  const byId = (id: string) => records.find((r) => r.dedupeKey.startsWith(`claude_code:${id}`))

  it("counts each response once, across content-block lines and the subagent file", () => {
    expect(records).toHaveLength(3)
    expect(byId("msg_01CanaryAAAA")).toMatchObject({
      model: "claude-sonnet-5-5",
      surface: "cli",
      sessionId: CLAUDE_SESSION,
      toolVersion: "2.1.332",
      inputTokens: 3000,
      cacheReadTokens: 9000,
      cacheWriteTokens: 500,
      // The block-0 line carried a streaming placeholder of 1.
      outputTokens: 120,
      reasoningTokens: 40,
    })
    expect(byId("msg_02CanaryBBBB")).toMatchObject({ inputTokens: 200, cacheReadTokens: 12000, outputTokens: 80 })
    expect(byId("msg_05SubagentC")).toMatchObject({ model: "claude-haiku-5-5", surface: "ide", cacheWriteTokens: 1000 })
  })

  it("skips local <synthetic> lines and reports drift in counts", () => {
    expect(records.some((r) => r.model === "<synthetic>")).toBe(false)
    expect(health).toMatchObject({
      parser: "claude-code/transcript@1",
      files: 2,
      lines: 14,
      records: 3,
      malformedLines: 1,
      unknownLineTypes: 1,
      usageLinesWithoutUsage: 1,
      toolVersions: ["2.1.332"],
    })
  })

  it("maps entrypoints to coarse surfaces", () => {
    expect(claudeCodeSurface("cli")).toBe("cli")
    expect(claudeCodeSurface("claude-jetbrains")).toBe("ide")
    expect(claudeCodeSurface("claude-desktop")).toBe("app")
    expect(claudeCodeSurface("sdk-py")).toBe("sdk")
    expect(claudeCodeSurface("remote")).toBe("other")
    expect(claudeCodeSurface(undefined)).toBe("other")
  })

  it("falls back to the request id when a line has no message id", () => {
    const line = JSON.stringify({
      type: "assistant", timestamp: "2026-11-20T10:00:00Z", sessionId: CLAUDE_SESSION, requestId: "req_0000OnlyThis",
      message: { model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 2 } },
    })
    const { records } = parseClaudeCode([[line]])
    expect(records[0]).toMatchObject({ dedupeKey: "claude_code::req_0000OnlyThis", outputTokens: 2, reasoningTokens: 0 })
  })
})

describe("Codex rollout parser", () => {
  it("reads token_usage_record rows, one per response, with the turn's model", () => {
    const { records, planWindows, health } = parseCodex([lines("codex-rollout.jsonl")])
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      tool: "codex", surface: "cli", sessionId: CODEX_SESSION, toolVersion: "0.172.0", model: "gpt-5.5-codex",
      // OpenAI counts cached input inside input_tokens; Sanction does not.
      inputTokens: 1024, cacheReadTokens: 1024, cacheWriteTokens: 0, outputTokens: 64, reasoningTokens: 16,
    })
    expect(records[1]).toMatchObject({ model: "gpt-5.5", inputTokens: 1500, cacheReadTokens: 3000, cacheWriteTokens: 500, outputTokens: 200 })
    expect(health).toMatchObject({ parser: "codex/rollout@1", files: 1, lines: 11, records: 2, unknownLineTypes: 0, usageLinesWithoutUsage: 0 })

    // Plan windows: one reading per token_count, including the rate-limit-only one.
    expect(planWindows).toHaveLength(6)
    expect(planWindows[0]).toMatchObject({ limitId: "codex", window: "primary", windowMinutes: 300, usedPercent: 12.5, planType: "plus" })
    expect(planWindows[0].resetsAt?.toISOString()).toBe(new Date(1795621780 * 1000).toISOString())
  })

  it("falls back to differences between running totals in older rollouts", () => {
    const { records, planWindows, health } = parseCodex([lines("codex-rollout-legacy.jsonl")])
    expect(records.map((r) => [r.inputTokens, r.cacheReadTokens, r.outputTokens, r.reasoningTokens])).toEqual([
      [800, 200, 50, 10], // first call: the whole running total
      [500, 1000, 40, 10], // the repeated total in between was skipped
      [300, 0, 20, 0], // the total went backwards, so last_token_usage was used
    ])
    expect(records.every((r) => r.surface === "ide" && r.model === "gpt-5" && r.sessionId === LEGACY_SESSION)).toBe(true)
    expect(health.usageLinesWithoutUsage).toBe(1)
    // Older Codex said seconds-until-reset instead of a timestamp.
    expect(planWindows[0]).toMatchObject({ limitId: "codex", usedPercent: 5, planType: null })
    expect(planWindows[0].resetsAt?.toISOString()).toBe("2026-11-21T10:00:10.000Z")
  })

  it("counts a response once even when a resumed session repeats it in another file", () => {
    const { records } = parseCodex([lines("codex-rollout.jsonl"), lines("codex-rollout.jsonl")])
    expect(records).toHaveLength(2)
  })

  it("needs a session and a model before it counts anything", () => {
    const usage = { input_tokens: 10, output_tokens: 1 }
    const noMeta = [
      JSON.stringify({ timestamp: "2026-11-20T14:00:00Z", type: "token_usage_record", payload: { response_id: "resp_orphan01", usage } }),
      JSON.stringify({ timestamp: "2026-11-20T14:00:00Z", type: "token_usage_record", payload: { usage } }),
      JSON.stringify({ timestamp: "2026-11-20T14:00:00Z", type: "mystery", payload: {} }),
      JSON.stringify({ timestamp: "2026-11-20T14:00:00Z", type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 1, window_minutes: 0 }, secondary: { used_percent: -1 } } } }),
    ]
    const { records, planWindows, health } = parseCodex([noMeta])
    expect(records).toHaveLength(0)
    expect(planWindows).toHaveLength(0)
    expect(health.usageLinesWithoutUsage).toBe(2)
    expect(health.unknownLineTypes).toBe(1)
  })

  it("maps originators to coarse surfaces", () => {
    expect(codexSurface("codex_exec")).toBe("exec")
    expect(codexSurface("Codex Desktop")).toBe("app")
    expect(codexSurface("codex_sdk_ts")).toBe("sdk")
    expect(codexSurface("something_new")).toBe("other")
    expect(codexSurface(7)).toBe("other")
  })
})

describe("rollup", () => {
  it("buckets records by tool, surface, model, hashed session and hour", () => {
    const { records } = parseClaudeCode([lines("claude-session.jsonl"), lines("claude-subagent.jsonl")])
    const facts = rollupRecords(records)
    expect(facts).toHaveLength(3)
    expect(facts[0]).toEqual({
      tool: "claude_code", surface: "cli", model: "claude-sonnet-5-5", sessionRef: sessionRef("claude_code", CLAUDE_SESSION),
      hourStart: "2026-11-20T10:00:00.000Z", requests: 1,
      inputTokens: 3000, outputTokens: 120, cacheReadTokens: 9000, cacheWriteTokens: 500, reasoningTokens: 40,
    })
    expect(sessionRef("claude_code", CLAUDE_SESSION)).toMatch(/^[0-9a-f]{32}$/)
    expect(sessionRef("codex", CLAUDE_SESSION)).not.toBe(sessionRef("claude_code", CLAUDE_SESSION))
  })

  it("adds up requests within the same bucket", () => {
    const { records } = parseCodex([lines("codex-rollout.jsonl")])
    const same = records.map((r) => ({ ...r, model: "gpt-5.5" }))
    const [fact] = rollupRecords(same)
    expect(fact).toMatchObject({ requests: 2, inputTokens: 2524, cacheReadTokens: 4024, outputTokens: 264, reasoningTokens: 66 })
  })

  it("keeps each plan window's peak and latest reading per hour", () => {
    const { planWindows } = parseCodex([lines("codex-rollout.jsonl")])
    const out = rollupPlanWindows([...planWindows].reverse())
    expect(out).toHaveLength(2)
    expect(out.find((w) => w.window === "primary")).toMatchObject({
      hourStart: "2026-11-20T14:00:00.000Z", peakPercent: 19, lastPercent: 17, lastObservedAt: "2026-11-20T14:55:00.000Z", planType: "plus",
    })
    expect(out.find((w) => w.window === "secondary")).toMatchObject({ peakPercent: 41, lastPercent: 41 })
  })
})

describe("discovery", () => {
  let root: string
  const env = () => ({ CLAUDE_CONFIG_DIR: join(root, "claude"), CODEX_HOME: join(root, "codex") })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "collector-"))
    const project = join(root, "claude/projects/-Users-canary-secret-project")
    mkdirSync(join(project, CLAUDE_SESSION, "subagents"), { recursive: true })
    mkdirSync(join(project, CLAUDE_SESSION, "tool-results"), { recursive: true })
    writeFileSync(join(project, `${CLAUDE_SESSION}.jsonl`), readFileSync(join(FIX, "claude-session.jsonl")))
    writeFileSync(join(project, CLAUDE_SESSION, "subagents", "agent-a1b2c3d4.jsonl"), readFileSync(join(FIX, "claude-subagent.jsonl")))
    // Files that sit beside transcripts and must never be read.
    writeFileSync(join(project, CLAUDE_SESSION, "tool-results", "result-a1b2c3d4.jsonl"), '{"type":"assistant","CANARY":"tool output"}\n')
    writeFileSync(join(project, "notes.txt"), "CANARY_NOTES")
    writeFileSync(join(root, "claude/.claude.json"), '{"oauthAccount":{"emailAddress":"canary@example.com"}}')
    writeFileSync(join(root, "claude/history.jsonl"), '{"display":"CANARY_PROMPT"}\n')
    // A symlink that would lead a scan out of the tool's folder.
    writeFileSync(join(root, "outside.jsonl"), readFileSync(join(FIX, "claude-subagent.jsonl")))
    symlinkSync(join(root, "outside.jsonl"), join(project, "6f1c2b9e-9999-4aaa-8bbb-0000000000ff.jsonl"))

    const day = join(root, "codex/sessions/2026/11/20")
    mkdirSync(day, { recursive: true })
    mkdirSync(join(root, "codex/sessions/2026/11/22"), { recursive: true })
    mkdirSync(join(root, "codex/sessions/notes"), { recursive: true })
    mkdirSync(join(root, "codex/archived_sessions"), { recursive: true })
    writeFileSync(join(day, `rollout-2026-11-20T14-00-00-${CODEX_SESSION}.jsonl`), readFileSync(join(FIX, "codex-rollout.jsonl")))
    writeFileSync(join(root, `codex/archived_sessions/rollout-2026-11-21T09-00-00-${LEGACY_SESSION}.jsonl`), readFileSync(join(FIX, "codex-rollout-legacy.jsonl")))
    writeFileSync(join(root, "codex/sessions/2026/11/22/rollout-2026-11-22T09-00-00-019a0b1c-4444.jsonl.zst"), "compressed")
    writeFileSync(join(root, `codex/sessions/notes/rollout-2026-11-20T14-00-00-${CODEX_SESSION}.jsonl`), "CANARY")
    writeFileSync(join(root, "codex/auth.json"), '{"OPENAI_API_KEY":"sk-canary-123456"}')
    writeFileSync(join(root, "codex/history.jsonl"), '{"text":"CANARY_PROMPT"}\n')
    writeFileSync(join(root, "codex/state_5.sqlite"), "CANARY_STATE")
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it("finds only session files, skipping symlinks, credentials and history", () => {
    const claude = findClaudeCode(claudeCodeRoots(env()))
    expect(claude.files.map((f) => f.slice(root.length)).sort()).toEqual([
      `/claude/projects/-Users-canary-secret-project/${CLAUDE_SESSION}.jsonl`,
      `/claude/projects/-Users-canary-secret-project/${CLAUDE_SESSION}/subagents/agent-a1b2c3d4.jsonl`,
    ])
    const codex = findCodex(codexRoots(env()))
    expect(codex.files.map((f) => f.slice(root.length)).sort()).toEqual([
      `/codex/archived_sessions/rollout-2026-11-21T09-00-00-${LEGACY_SESSION}.jsonl`,
      `/codex/sessions/2026/11/20/rollout-2026-11-20T14-00-00-${CODEX_SESSION}.jsonl`,
    ])
    expect(codex.skippedFiles).toBe(1)
  })

  it("uses the tools' default folders when no override is set", () => {
    expect(claudeCodeRoots({}, "/home/u")).toEqual(["/home/u/.claude", "/home/u/.config/claude"])
    expect(claudeCodeRoots({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toEqual(["/home/u/.claude", "/xdg/claude"])
    expect(codexRoots({}, "/home/u")).toEqual(["/home/u/.codex"])
    expect(findClaudeCode(["/nonexistent"]).files).toEqual([])
  })

  it("re-reads a whole session when any of its files changed", () => {
    const old = new Date("2026-01-01T00:00:00Z")
    const main = join(root, "claude/projects/-Users-canary-secret-project", `${CLAUDE_SESSION}.jsonl`)
    utimesSync(main, old, old)
    const since = new Date(statSync(main).mtimeMs + 1000)
    // Only the subagent file is new, but both come back.
    expect(findClaudeCode(claudeCodeRoots(env()), since).files).toHaveLength(2)
    const sub = join(root, "claude/projects/-Users-canary-secret-project", CLAUDE_SESSION, "subagents/agent-a1b2c3d4.jsonl")
    utimesSync(sub, old, old)
    expect(findClaudeCode(claudeCodeRoots(env()), since).files).toHaveLength(0)

    const legacy = join(root, `codex/archived_sessions/rollout-2026-11-21T09-00-00-${LEGACY_SESSION}.jsonl`)
    utimesSync(legacy, old, old)
    expect(findCodex(codexRoots(env()), since).files).toHaveLength(1)
  })

  it("keeps prompts, paths, secrets and ids out of the batch", () => {
    const result = scan({ tools: ["claude_code", "codex"], since: null, env: env() })
    const body = encodeBatch(buildBatch({ deviceId: "dev_test_0001", ...result }))
    for (const canary of [
      "CANARY", "canary", "/Users", "secret-project", "sk-", "@example.com", "Bearer",
      CLAUDE_SESSION, CODEX_SESSION, LEGACY_SESSION, "msg_", "req_", "resp_", "turn-", "toolu_",
    ]) {
      expect(body, canary).not.toContain(canary)
    }
    const batch = JSON.parse(body)
    expect(batch.schema).toBe(BATCH_SCHEMA)
    // Claude: 3 buckets. Codex: two models in one hour, plus the legacy session's three calls in one hour.
    expect(batch.facts.length).toBe(3 + 2 + 1)
    expect(Object.keys(batch.facts[0]).sort()).toEqual([
      "cacheReadTokens", "cacheWriteTokens", "hourStart", "inputTokens", "model", "outputTokens",
      "reasoningTokens", "requests", "sessionRef", "surface", "tool",
    ])
    expect(batch.health.map((h: { parser: string }) => h.parser)).toEqual(["claude-code/transcript@1", "codex/rollout@1"])
  })

  it("reads nothing for a tool the person left off", () => {
    const result = scan({ tools: ["codex"], since: null, env: env() })
    expect(result.facts.every((f) => f.tool === "codex")).toBe(true)
    expect(result.health).toHaveLength(1)
  })

  it("copies only named fields into a batch, even if a record carries more", () => {
    const sneaky = { ...rollupRecords(parseCodex([lines("codex-rollout.jsonl")]).records)[0], prompt: "CANARY_PROMPT" }
    const health = { ...emptyHealth("codex/rollout@1"), cwd: "/Users/canary" }
    const body = encodeBatch(buildBatch({ deviceId: "dev_test_0001", facts: [sneaky], planWindows: [], health: [health] }))
    expect(body).not.toContain("CANARY")
    expect(body).not.toContain("/Users")
  })

  it("command line: scan, preview, keygen and errors", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"))
    vi.stubEnv("CODEX_HOME", join(root, "codex"))
    const out: string[] = []
    const err: string[] = []
    const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) }

    expect(main(["scan"], io)).toBe(0)
    expect(out.some((l) => l.includes("2026-11-20  claude_code  claude-sonnet-5-5"))).toBe(true)
    expect(out.some((l) => l.includes("codex plan codex/primary: 17% of 300 min window"))).toBe(true)
    expect(out.some((l) => l.startsWith("codex/rollout@1: 2 files, 5 requests"))).toBe(true)

    out.length = 0
    expect(main(["preview", "--tools", "claude_code", "--since", "2026-01-01"], io)).toBe(0)
    const preview = JSON.parse(out.join("\n"))
    expect(preview.deviceId).toBe("unpaired")
    expect(preview.facts).toHaveLength(3)

    out.length = 0
    expect(main(["keygen"], io)).toBe(0)
    expect(out[0]).toMatch(/^public key: [A-Za-z0-9_-]{43}$/)
    const keyPath = join(root, "device.pem")
    expect(main(["keygen", "--out", keyPath], io)).toBe(0)
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    // Never overwrites an existing key.
    expect(main(["keygen", "--out", keyPath], io)).toBe(1)

    expect(main(["scan", "--tools", "cursor"], io)).toBe(1)
    expect(err.at(-1)).toContain("unknown tool: cursor")
    expect(main(["scan", "--since", "yesterday-ish"], io)).toBe(1)
    expect(main(["upload"], io)).toBe(2)
  })
})

describe("readLines", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "collector-lines-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("splits across chunk boundaries and keeps a last line with no newline", () => {
    const long = "a".repeat(100_000)
    const p = join(dir, "f.jsonl")
    writeFileSync(p, `${long}\nshort\n\nlast`)
    expect([...readLines(p)]).toEqual([long, "short", "", "last"])
  })

  it("drops a line longer than the limit without reading it into memory", () => {
    const p = join(dir, "f.jsonl")
    writeFileSync(p, `keep\n${"x".repeat(200_000)}\nalso\n${"y".repeat(200_000)}`)
    expect([...readLines(p, 70_000)]).toEqual(["keep", "also"])
  })

  it("handles multi-byte characters split across chunks", () => {
    const p = join(dir, "f.jsonl")
    const text = `${"é".repeat(40_000)}\nend`
    writeFileSync(p, text)
    expect([...readLines(p)]).toEqual(["é".repeat(40_000), "end"])
  })
})

describe("signing", () => {
  it("a batch signed with the device key verifies on the server, and an edited one does not", () => {
    const key = generateDeviceKey()
    const batch = buildBatch({ deviceId: "dev_test_0001", facts: [], planWindows: [], health: [], now: new Date("2026-11-21T12:00:00Z") })
    const body = encodeBatch(batch)
    const signature = signBody(body, key.privateKeyPem)
    const headers = batchHeaders(batch, signature)
    expect(headers["x-sanction-device"]).toBe("dev_test_0001")
    expect(verifyCollectorSignature(body, headers["x-sanction-signature"], key.publicKey)).toBe(true)
    expect(verifyCollectorSignature(body.replace("dev_test_0001", "dev_test_0002"), headers["x-sanction-signature"], key.publicKey)).toBe(false)
    expect(verifyCollectorSignature(body, headers["x-sanction-signature"], generateDeviceKey().publicKey)).toBe(false)
  })
})
