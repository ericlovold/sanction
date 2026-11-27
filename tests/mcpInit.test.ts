import { describe, expect, it, vi } from "vitest"
import { KEY_CHECK, KEY_OPTION, SEAT_PAGE, STEPS, keyProblem, runInit, type InitIo, type RunResult } from "@/lib/mcpInit"

const KEY = "pxy_" + "a".repeat(64)
const ok = (body: object): RunResult => ({ code: 0, stdout: JSON.stringify(body, null, 2), stderr: "" })

/** A scripted Claude Code: every call is recorded, the key store is a variable. */
function fake(overrides: Partial<InitIo> & { stored?: string; answers?: string[]; secrets?: string[]; fail?: string } = {}) {
  const state = { stored: overrides.stored ?? "", calls: [] as { args: string[]; input?: string }[], printed: [] as string[] }
  const answers = [...(overrides.answers ?? [])]
  const secrets = [...(overrides.secrets ?? [])]
  const io: InitIo = {
    run: vi.fn(async (command: string, args: string[], input?: string) => {
      expect(command).toBe("claude")
      state.calls.push({ args, input })
      if (args[0] === "--version") return { code: 0, stdout: "2.1.329 (Claude Code)\n", stderr: "" }
      if (overrides.fail && args.includes(overrides.fail)) return { code: 1, stdout: "", stderr: "boom\nlast line of detail" }
      if (args.includes("--values-stdin")) { state.stored = JSON.parse(input!)[KEY_OPTION]; return ok({ saved: [KEY_OPTION], unconfigured: [] }) }
      if (args[1] === "configure") return ok(state.stored ? { configured: [KEY_OPTION], unconfigured: [] } : { configured: [], unconfigured: [KEY_OPTION] })
      // Progress lines before the JSON, as the real marketplace add prints them.
      return { code: 0, stdout: `Cloning…\n${JSON.stringify({ outcome: "ok" })}`, stderr: "" }
    }),
    ask: vi.fn(async () => answers.shift() ?? ""),
    askSecret: vi.fn(async () => secrets.shift() ?? ""),
    print: (line) => { state.printed.push(line) },
    open: vi.fn(async () => true),
    check: vi.fn(async () => 200),
    env: {},
    nodeVersion: "v22.1.0",
    interactive: true,
    ...Object.fromEntries(Object.entries(overrides).filter(([name]) => !["stored", "answers", "secrets", "fail"].includes(name))),
  }
  const mutating = () => state.calls.filter(call => call.args[0] === "plugin" && !(call.args[1] === "configure" && !call.args.includes("--values-stdin")))
  return { io, state, mutating, text: () => state.printed.join("\n") }
}

describe("sanction-mcp init", () => {
  it("shows the commands, asks, then installs and stores the key on stdin only", async () => {
    const { io, state, mutating, text } = fake({ answers: ["y"], secrets: [KEY] })
    expect(await runInit([], io)).toBe(0)
    expect(mutating().map(call => call.args)).toEqual([STEPS[0].args, STEPS[1].args, ["plugin", "configure", "sanction@sanction", "--values-stdin", "--json"]])
    // What was printed before the question is what ran.
    for (const step of STEPS) expect(text()).toContain(`claude ${step.args.filter(arg => arg !== "--json").join(" ")}`)
    expect(state.stored).toBe(KEY)
    // The key is never in argv and never printed.
    expect(state.calls.flatMap(call => call.args).join(" ")).not.toContain(KEY)
    expect(text()).not.toContain(KEY)
    expect(state.calls.filter(call => call.input).map(call => call.input)).toEqual([JSON.stringify({ [KEY_OPTION]: KEY })])
    expect(io.open).toHaveBeenCalledWith(SEAT_PAGE)
    expect(io.check).toHaveBeenCalledWith(KEY_CHECK, KEY)
    expect(text()).toContain("git push --dry-run")
  })

  it("changes nothing without a yes", async () => {
    for (const answer of ["", "n", "maybe"]) {
      const { io, mutating, text } = fake({ answers: [answer] })
      expect(await runInit([], io)).toBe(0)
      expect(mutating()).toEqual([])
      expect(text()).toContain("Nothing was changed.")
    }
    const piped = fake({ interactive: false })
    expect(await runInit([], piped.io)).toBe(1)
    expect(piped.mutating()).toEqual([])
  })

  it("stops before any change when Node or Claude Code is missing or too old", async () => {
    const old = (stdout: string) => fake({ run: vi.fn(async () => ({ code: 0, stdout, stderr: "" })) })
    for (const { io } of [fake({ nodeVersion: "v18.20.4" }), old("2.1.294 (Claude Code)"), old("1.9.999"), fake({ run: vi.fn(async () => ({ code: 127, stdout: "", stderr: "ENOENT" })) }), fake({ run: vi.fn(async () => { throw new Error("spawn failed") }) })]) {
      expect(await runInit(["--yes"], io)).toBe(1)
      expect(io.ask).not.toHaveBeenCalled()
      expect(vi.mocked(io.run).mock.calls.every(call => call[1][0] === "--version")).toBe(true)
    }
  })

  it("refuses a management key, a malformed key and a key Sanction rejects", async () => {
    expect(keyProblem("sk_" + "b".repeat(64))).toMatch(/management key/)
    for (const bad of ["", "pxy_short", "pxy_" + "a".repeat(30) + " x", "hello"]) expect(keyProblem(bad)).not.toBeNull()
    expect(keyProblem(KEY)).toBeNull()

    const retry = fake({ answers: ["y"], secrets: ["sk_" + "b".repeat(64), "nope", KEY] })
    expect(await runInit([], retry.io)).toBe(0)
    expect(retry.state.stored).toBe(KEY)

    const never = fake({ answers: ["y"], secrets: ["x", "y", "z", KEY] })
    expect(await runInit([], never.io)).toBe(1)
    expect(never.state.stored).toBe("")

    // 400 is what the live endpoint returns for an unknown key with no wallet_id.
    for (const status of [400, 401, 403]) {
      const refused = fake({ answers: ["y"], secrets: [KEY], check: vi.fn(async () => status) })
      expect(await runInit([], refused.io)).toBe(1)
      expect(refused.state.stored).toBe("")
      expect(refused.text()).toContain("does not recognise that key")
    }
  })

  it("stores the key when Sanction cannot check it, and says so", async () => {
    for (const [status, message] of [[0, "Could not reach Sanction"], [503, "HTTP 503"], [429, "HTTP 429"]] as const) {
      const { io, state, text } = fake({ answers: ["y"], secrets: [KEY], check: vi.fn(async () => status) })
      expect(await runInit([], io)).toBe(0)
      expect(state.stored).toBe(KEY)
      expect(text()).toContain(message)
    }
  })

  it("keeps a stored key unless told to replace it", async () => {
    const kept = fake({ stored: "pxy_existing", answers: ["y", "n"] })
    expect(await runInit([], kept.io)).toBe(0)
    expect(kept.state.stored).toBe("pxy_existing")
    expect(kept.io.askSecret).not.toHaveBeenCalled()

    const unattended = fake({ stored: "pxy_existing" })
    expect(await runInit(["--yes"], unattended.io)).toBe(0)
    expect(unattended.state.stored).toBe("pxy_existing")

    const replaced = fake({ stored: "pxy_existing", answers: ["y", "y"], secrets: [KEY] })
    expect(await runInit([], replaced.io)).toBe(0)
    expect(replaced.state.stored).toBe(KEY)
  })

  it("takes the key from the environment for unattended setup", async () => {
    const { io, state } = fake({ interactive: false, env: { SANCTION_AGENT_KEY: KEY } })
    expect(await runInit(["--yes", "--no-open"], io)).toBe(0)
    expect(state.stored).toBe(KEY)
    expect(io.askSecret).not.toHaveBeenCalled()
    expect(io.open).not.toHaveBeenCalled()

    const bad = fake({ interactive: false, env: { SANCTION_AGENT_KEY: "sk_" + "b".repeat(64) } })
    expect(await runInit(["--yes"], bad.io)).toBe(1)
    expect(bad.state.stored).toBe("")

    const none = fake({ interactive: false })
    expect(await runInit(["--yes"], none.io)).toBe(1)
  })

  it("reports a failed step with the command and stops", async () => {
    const { io, state, text } = fake({ answers: ["y"], secrets: [KEY], fail: "install" })
    expect(await runInit([], io)).toBe(1)
    expect(text()).toContain("claude plugin install sanction@sanction")
    expect(text()).toContain("last line of detail")
    expect(state.stored).toBe("")
    expect(io.askSecret).not.toHaveBeenCalled()
  })

  it("prints usage for --help and refuses unknown options without running anything", async () => {
    const help = fake()
    expect(await runInit(["--help"], help.io)).toBe(0)
    expect(help.text()).toContain("Usage: npx sanction-mcp init")
    const unknown = fake()
    expect(await runInit(["--url", "https://evil.test"], unknown.io)).toBe(2)
    expect(unknown.io.run).not.toHaveBeenCalled()
  })

  it("says so when Claude Code reports the key did not stick", async () => {
    const { io } = fake({ answers: ["y"], secrets: [KEY] })
    const real = vi.mocked(io.run).getMockImplementation()!
    vi.mocked(io.run).mockImplementation(async (command, args, input) =>
      args.includes("--values-stdin") ? ok({ saved: [], unconfigured: [KEY_OPTION] }) : real(command, args, input))
    expect(await runInit([], io)).toBe(1)
  })
})
