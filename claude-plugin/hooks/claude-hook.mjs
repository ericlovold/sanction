#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
const decision = (permissionDecision, permissionDecisionReason) => ({ hookSpecificOutput: {
  hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason,
} })
const RULE_LABEL = /^[a-z0-9][a-z0-9-]{0,39}$/

/** `--require-approval` asks for a human decision without a policy edit;
 * `--rule <label>` names the host-side filter that fired. Throws on anything
 * else so a mistyped install denies instead of silently running ungated. */
export function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--require-approval") options.requireApproval = true
    else if (argv[i] === "--rule" && RULE_LABEL.test(argv[i + 1] ?? "")) options.rule = argv[++i]
    else throw Error("Invalid hook arguments")
  }
  return options
}

// Host-installed adapter, not a tamper-proof sandbox. No key or tool input is
// written to disk. One pending request per exact session/tool/input binding.
export async function runHook(input, env = process.env, request = fetch, options = {}) {
  let lock
  try {
    if (input.hook_event_name !== "PreToolUse" || typeof input.session_id !== "string" || !input.session_id ||
        typeof input.cwd !== "string" || !input.cwd || typeof input.tool_name !== "string" || !input.tool_name || !input.tool_input || typeof input.tool_input !== "object" || Array.isArray(input.tool_input)) throw Error("Invalid hook input")
    if (options.rule !== undefined && !RULE_LABEL.test(options.rule)) throw Error("Invalid rule label")
    const origin = new URL(env.SANCTION_URL || "https://getsanction.com")
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw Error("HTTPS required")
    // An explicit environment key wins; the plugin option is how Claude Code
    // hands over a value it keeps in the platform's secure store.
    const key = env.SANCTION_AGENT_KEY || env.CLAUDE_PLUGIN_OPTION_SANCTION_AGENT_KEY
    if (origin.username || origin.password || !key) throw Error("Missing configuration")
    // The rule label rides in approval_reason, so it is part of the binding:
    // two host filters matching one command hold separate requests instead of
    // racing for one grant.
    const payload = {
      tool: `claude-code.${input.tool_name}`, server: "claude-code", arguments: { cwd: input.cwd, input: input.tool_input },
      ...(options.requireApproval ? { require_approval: true, approval_reason: `Claude Code rule: ${options.rule ?? "manual"}` } : {}),
    }
    const binding = createHash("sha256").update(JSON.stringify(canonical([origin.origin, createHash("sha256").update(key).digest("hex"), input.session_id, payload]))).digest("hex")
    const directory = env.SANCTION_HOOK_STATE_DIR || join(homedir(), ".local", "state", "sanction", "hooks")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const file = join(directory, `${binding}.json`)
    const lockPath = `${file}.lock`
    // A killed hook leaves a lock: refuse rather than race another redemption.
    await mkdir(lockPath, { mode: 0o700 })
    lock = lockPath
    let state
    try { state = JSON.parse(await readFile(file, "utf8")) } catch (error) { if (error.code !== "ENOENT") throw error }
    if (!state) {
      state = { idempotency: randomUUID() }
      await writeFile(file, JSON.stringify(state), { mode: 0o600 })
    }
    const signal = AbortSignal.timeout(8000) // shared deadline across poll + redemption
    const call = async (path, body, idempotency) => {
      const response = await request(new URL(path, origin), {
        method: body ? "POST" : "GET", redirect: "error", signal,
        headers: { "x-api-key": key, "content-type": "application/json", ...(idempotency ? { "idempotency-key": idempotency } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (response.status >= 500 || response.status === 401) throw Error("Sanction unavailable")
      return { found: response.status !== 404, body: await response.json() }
    }
    const inbox = new URL("/dashboard/approvals", origin).href
    let grant
    if (state.requestId) {
      const { found, body: status } = await call(`/api/v1/authorize/${encodeURIComponent(state.requestId)}`)
      grant = status.grant_id
      // A rejected, timed-out or vanished request is terminal: drop the pending
      // state so the next attempt opens a new decision. Never allow from here.
      if (!found || status.status === "denied") {
        await rm(file)
        return decision("deny", `Sanction request ${state.requestId} was denied or expired. This action stays blocked. Retrying opens a new request.`)
      }
      if (!grant) return decision("deny", `Sanction approval required. Review request ${state.requestId} at ${inbox}, then retry this exact action.`)
    }
    const { body: result } = await call("/api/v1/authorize/tool", { ...payload, ...(grant ? { grant_id: grant } : {}) }, grant ? undefined : state.idempotency)
    // Observe mode must not masquerade as an enforced permission decision.
    if (result.authorized === true && result.status === "allowed" && !result.observed && !result.would_be) {
      await rm(file)
      return decision("allow", "Sanction authorized this exact tool request. Native client restrictions still apply.")
    }
    if (grant) {
      // The grant answered and did not authorize (consumed, expired, or bound
      // to a different request). It never will; stop presenting it.
      await rm(file)
      return decision("deny", `Sanction could not redeem the approval for request ${state.requestId}. This action stays blocked. Retrying opens a new request.`)
    }
    if (result.request_id && result.status !== "denied") {
      state.requestId = result.request_id
      await writeFile(file, JSON.stringify(state), { mode: 0o600 })
      return decision("deny", `Sanction stopped this action. Review request ${result.request_id} at ${inbox}, then retry the exact action.`)
    }
    // A policy denial has no human decision to wait on; keep nothing pending,
    // so a retry after a policy change is evaluated fresh. Only a well-formed
    // machine code is echoed to the model, never free server text.
    await rm(file)
    const code = typeof result.code === "string" && /^[A-Z][A-Z_]{0,39}$/.test(result.code) ? ` (${result.code})` : ""
    return decision("deny", `Sanction refused this action${code}. Approval cannot override a policy denial. Check the wallet's policy and connection settings.`)
  } catch {
    return decision("deny", "Sanction could not verify permission. Action blocked. Check configuration, connectivity, and pending hook locks.")
  } finally {
    if (lock) await rm(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = ""
  try {
    const options = parseArgs(process.argv.slice(2))
    for await (const chunk of process.stdin) {
      raw += chunk
      if (Buffer.byteLength(raw) > 65536) throw Error("Hook input too large")
    }
    process.stdout.write(JSON.stringify(await runHook(JSON.parse(raw), process.env, fetch, options)) + "\n")
  } catch { process.stdout.write(JSON.stringify(decision("deny", "Invalid or oversized Sanction hook input.")) + "\n") }
}
