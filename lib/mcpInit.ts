/**
 * `npx sanction-mcp init` — set up the Sanction plugin for Claude Code.
 *
 * It runs three `claude plugin` commands and nothing else: add the marketplace,
 * install the plugin, and hand the plugin a seat key. Every command is shown
 * before it runs. The key is read without echo, goes to Claude Code on stdin,
 * and is never placed in argv, printed, or written to a file by this code.
 *
 * All side effects go through `InitIo`, so the flow is tested without a
 * terminal, a browser, the network, or Claude Code.
 */

export type RunResult = { code: number; stdout: string; stderr: string }

export type InitIo = {
  /** Run a program with an argument array, never through a shell string. */
  run(command: string, args: string[], input?: string): Promise<RunResult>
  /** One visible line of input. */
  ask(question: string): Promise<string>
  /** One line of input that is not echoed. */
  askSecret(question: string): Promise<string>
  print(line: string): void
  /** Best-effort; false when no browser could be opened. */
  open(url: string): Promise<boolean>
  /** GET with the key in `x-api-key`; resolves to the HTTP status, or 0 when unreachable. */
  check(url: string, key: string): Promise<number>
  env: Record<string, string | undefined>
  nodeVersion: string
  interactive: boolean
}

export const MARKETPLACE = "ericlovold/sanction"
export const PLUGIN = "sanction@sanction"
export const KEY_OPTION = "sanction_agent_key"
export const SEAT_PAGE = "https://getsanction.com/dashboard/connect/claude-code"
export const KEY_CHECK = "https://getsanction.com/api/v1/wallets/stats"
const MIN_CLAUDE = [2, 1, 295]
const MIN_NODE = 20

/** The commands, as data, so what is printed is exactly what runs. */
export const STEPS: { label: string; args: string[] }[] = [
  // Sparse: the plugin needs two folders of the repository, not all of it.
  { label: "Add the Sanction marketplace", args: ["plugin", "marketplace", "add", MARKETPLACE, "--sparse", ".claude-plugin", "claude-plugin", "--json"] },
  { label: "Install the plugin", args: ["plugin", "install", PLUGIN, "--json"] },
]
const CONFIGURE_READ = ["plugin", "configure", PLUGIN, "--json"]
const CONFIGURE_WRITE = ["plugin", "configure", PLUGIN, "--values-stdin", "--json"]

const USAGE = [
  "Usage: npx sanction-mcp init [--yes] [--no-open]",
  "",
  "Sets up the Sanction plugin for Claude Code: adds the marketplace, installs",
  "the plugin, and stores a seat key in Claude Code's secure storage.",
  "",
  "  --yes      Run the commands without asking first.",
  "  --no-open  Print the seat page address instead of opening a browser.",
  "",
  "Set SANCTION_AGENT_KEY to supply the key without a prompt.",
].join("\n")

function atLeast(found: number[], wanted: number[]): boolean {
  for (let i = 0; i < wanted.length; i++) {
    if ((found[i] ?? 0) !== wanted[i]) return (found[i] ?? 0) > wanted[i]
  }
  return true
}

/** Claude Code prints one JSON object, sometimes after progress lines. */
function parseJson(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim()
  for (const candidate of [text, text.slice(text.lastIndexOf("\n{") + 1), text.split("\n").at(-1) ?? ""]) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
    } catch { /* try the next shape */ }
  }
  return null
}

/** Why a pasted value is not a seat key, or null when it looks like one. */
export function keyProblem(value: string): string | null {
  if (!value) return "No key entered."
  if (/\s/.test(value)) return "A key has no spaces or line breaks."
  if (value.startsWith("sk_")) return "That is a management key. Use the seat's pxy_ key; a management key must never be given to an agent."
  if (!/^pxy_[A-Za-z0-9_-]{16,200}$/.test(value)) return "A seat key starts with pxy_."
  return null
}

const show = (args: string[]) => `claude ${args.filter(arg => arg !== "--json").join(" ")}`
const yes = (answer: string) => /^y(es)?$/i.test(answer.trim())

export async function runInit(argv: string[], io: InitIo): Promise<number> {
  const flags = new Set(argv)
  if (flags.has("--help") || flags.has("-h")) { io.print(USAGE); return 0 }
  for (const flag of flags) {
    if (flag !== "--yes" && flag !== "--no-open") { io.print(`Unknown option: ${flag}\n\n${USAGE}`); return 2 }
  }
  const assumeYes = flags.has("--yes")

  // 1. Preconditions. The plugin's hook runs on Node and needs a Claude Code
  // new enough to block the command when the hook fails.
  const node = Number(io.nodeVersion.replace(/^v/, "").split(".")[0])
  if (!(node >= MIN_NODE)) { io.print(`Node ${MIN_NODE} or newer is required; this is ${io.nodeVersion}.`); return 1 }
  const version = await io.run("claude", ["--version"]).catch(() => null)
  const found = version?.code === 0 ? version.stdout.match(/(\d+)\.(\d+)\.(\d+)/) : null
  if (!found) { io.print("Claude Code was not found on PATH. Install it from https://claude.com/claude-code, then run this again."); return 1 }
  if (!atLeast(found.slice(1, 4).map(Number), MIN_CLAUDE)) {
    io.print(`Claude Code ${MIN_CLAUDE.join(".")} or newer is required; this is ${found[0]}. Update it, then run this again.`)
    return 1
  }

  // 2. Say exactly what will run, and get a yes.
  io.print("This sets up the Sanction plugin for Claude Code. It will run:")
  for (const step of STEPS) io.print(`  ${show(step.args)}`)
  io.print(`  ${show(CONFIGURE_WRITE)}   (your seat key, on stdin)`)
  io.print("")
  if (!assumeYes) {
    if (!io.interactive) { io.print("Not a terminal. Run it again with --yes to proceed without the question."); return 1 }
    if (!yes(await io.ask("Run these? [y/N] "))) { io.print("Nothing was changed."); return 0 }
  }

  // 3. Marketplace and plugin.
  for (const step of STEPS) {
    io.print(`${step.label}…`)
    const result = await io.run("claude", step.args)
    if (result.code !== 0 || parseJson(result.stdout)?.outcome !== "ok") {
      io.print(`That failed (${show(step.args)}).`)
      const detail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join("\n")
      if (detail) io.print(detail)
      return 1
    }
  }

  // 4. The key. Leave an existing one alone unless the person says otherwise.
  const before = parseJson((await io.run("claude", CONFIGURE_READ)).stdout)
  const alreadySet = Array.isArray(before?.configured) && before.configured.includes(KEY_OPTION)
  let key = io.env.SANCTION_AGENT_KEY?.trim() ?? ""
  if (alreadySet && !key) {
    const replace = !assumeYes && io.interactive && yes(await io.ask("A seat key is already stored. Replace it? [y/N] "))
    if (!replace) { io.print("Kept the stored key."); return finish(io) }
  }
  if (key) {
    const problem = keyProblem(key)
    if (problem) { io.print(`SANCTION_AGENT_KEY: ${problem}`); return 1 }
  } else {
    if (!io.interactive) { io.print("No key to store. Set SANCTION_AGENT_KEY, or run this in a terminal."); return 1 }
    io.print("Create a seat for this machine and copy its key:")
    io.print(`  ${SEAT_PAGE}`)
    if (!flags.has("--no-open") && !(await io.open(SEAT_PAGE))) io.print("  (Could not open a browser; open that address yourself.)")
    for (let attempt = 0; attempt < 3 && !key; attempt++) {
      const entered = (await io.askSecret("Paste the seat key (it will not be shown): ")).trim()
      const problem = keyProblem(entered)
      if (problem) io.print(problem)
      else key = entered
    }
    if (!key) { io.print("No valid key entered. The plugin is installed; run this again when you have the key."); return 1 }
  }

  // 5. Check the key with Sanction before storing it. This endpoint answers
  // 200 to a live seat key and 400 to a key it does not recognise (no wallet
  // can be derived from it); 401 and 403 are refusals too. Anything else is an
  // outage or a rate limit, which must not block setup.
  const status = await io.check(KEY_CHECK, key)
  if (status === 400 || status === 401 || status === 403) { io.print("Sanction does not recognise that key. Check that the seat is active and the key is complete, then run this again."); return 1 }
  if (status !== 200) io.print(status === 0 ? "Could not reach Sanction to check the key. Storing it anyway." : `Sanction could not check the key just now (HTTP ${status}). Storing it anyway.`)

  // 6. Store it. The key travels on stdin only.
  const saved = await io.run("claude", CONFIGURE_WRITE, JSON.stringify({ [KEY_OPTION]: key }))
  const savedKeys = parseJson(saved.stdout)?.saved
  if (saved.code !== 0 || !Array.isArray(savedKeys) || !savedKeys.includes(KEY_OPTION)) {
    io.print("Claude Code did not store the key. Open /plugin in Claude Code, select Sanction on the Installed tab, and choose Configure.")
    return 1
  }
  io.print("Key stored in Claude Code's secure storage.")
  return finish(io)
}

async function finish(io: InitIo): Promise<number> {
  const after = parseJson((await io.run("claude", CONFIGURE_READ)).stdout)
  if (!Array.isArray(after?.unconfigured) || after.unconfigured.length > 0) {
    io.print("The plugin is installed but still has no key. Run this again, or set it under /plugin → Installed → Sanction → Configure.")
    return 1
  }
  io.print("")
  io.print("Done. Start a new Claude Code session (or run /reload-plugins) and ask it to run:")
  io.print("  git push --dry-run")
  io.print("It is blocked until you approve that request in Sanction. Retry it in the same session and it runs once.")
  return 0
}
