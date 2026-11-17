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
const gatedPrefixes = [
  "git push", "npm publish", "gh pr merge", "rm -rf",
  "terraform apply", "terraform destroy", "kubectl delete",
]
// Both the original hook and the plugin persist keys produced by randomUUID().
const idempotencyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseState(contents) {
  const state = JSON.parse(contents)
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      typeof state.idempotency !== "string" || !idempotencyUuid.test(state.idempotency) ||
      (state.requestId !== undefined && (typeof state.requestId !== "string" || !state.requestId.trim()))) {
    throw Error("Invalid pending hook state")
  }
  return state
}

// Conservative text matching also gates quoted mentions of an entire prefix.
export function mentions(command, prefix) {
  if (typeof command !== "string") return true
  // The shell deletes a backslash-newline outright, so `pu\<newline>sh` is `push`.
  const text = command.replace(/\\\r?\n/g, "").replace(/["'\\]/g, "")
  const words = prefix.split(" ").map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
  return new RegExp(`(?:^|[^A-Za-z0-9_./-])${words}(?=$|[\\s;&|)<>\`])`).test(text)
}

export function parseArgs(argv) {
  if (!argv.length) return {}
  if (argv.length === 1 && argv[0] === "--gate-bash") return { gateBash: true }
  throw Error("Invalid hook arguments")
}

// One local request per exact session/tool/input binding. The installed Bash
// hook returns no decision for unrelated commands or after a verified grant,
// so Claude Code still applies its own permission rules.
export async function runHook(input, env = process.env, request = fetch, options = {}) {
  let lock
  try {
    if (input.hook_event_name !== "PreToolUse" || typeof input.session_id !== "string" || !input.session_id ||
        typeof input.cwd !== "string" || !input.cwd || typeof input.tool_name !== "string" || !input.tool_name || !input.tool_input || typeof input.tool_input !== "object" || Array.isArray(input.tool_input)) throw Error("Invalid hook input")
    let approvalReason
    if (options.gateBash) {
      if (input.tool_name !== "Bash" || typeof input.tool_input.command !== "string" || !input.tool_input.command.trim()) throw Error("Invalid Bash input")
      const matches = gatedPrefixes.filter(prefix => mentions(input.tool_input.command, prefix))
      if (!matches.length) return null
      approvalReason = `Claude Code rules: ${matches.join(", ")}`
    }
    const origin = new URL(env.SANCTION_URL || "https://getsanction.com")
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw Error("HTTPS required")
    // An explicit environment key wins; the plugin option is how Claude Code
    // hands over a value it keeps in the platform's secure store.
    const key = env.SANCTION_AGENT_KEY || (origin.origin === "https://getsanction.com" && env.CLAUDE_PLUGIN_OPTION_SANCTION_AGENT_KEY)
    if (origin.username || origin.password || !key) throw Error("Missing configuration")
    const payload = {
      tool: `claude-code.${input.tool_name}`, server: "claude-code", arguments: { cwd: input.cwd, input: input.tool_input },
      ...(approvalReason ? { require_approval: true, approval_reason: approvalReason } : {}),
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
    try {
      state = parseState(await readFile(file, "utf8"))
    } catch (error) {
      if (error.code !== "ENOENT") throw error
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
      if (!body && response.status === 404) return { found: false, body: {} }
      const result = await response.json()
      if (!response.ok && !(body && [403, 404, 409].includes(response.status) && result.status === "denied" && result.authorized === false)) {
        throw Error("Sanction unavailable")
      }
      return { found: true, body: result }
    }
    const inbox = new URL("/dashboard/approvals", origin).href
    let grant
    if (state.requestId) {
      const { found, body: status } = await call(`/api/v1/authorize/${encodeURIComponent(state.requestId)}`)
      grant = status.grant_id
      // A rejected, timed-out or vanished request is terminal: drop the pending
      // state so the next attempt opens a new decision. Never allow from here.
      if (!found || status.status === "denied" || (status.status === "approved" && !grant)) {
        await rm(file)
        return decision("deny", `Sanction request ${state.requestId} has no usable approval. This action stays blocked.`)
      }
      if (!grant) return decision("deny", `Sanction approval required. Review request ${state.requestId} at ${inbox}, then retry this exact action.`)
    }
    const { body: result } = await call("/api/v1/authorize/tool", { ...payload, ...(grant ? { grant_id: grant } : {}) }, grant ? undefined : state.idempotency)
    // Observe mode must not masquerade as an enforced permission decision.
    if (result.authorized === true && result.status === "allowed" && !result.observed && !result.would_be) {
      if (options.gateBash && !(grant && result.grant_id === grant && result.grant_status === "consumed")) {
        throw Error("Expected consumption of the reviewed grant")
      }
      await rm(file)
      if (options.gateBash) return null
      return decision("allow", "Sanction authorized this exact tool request. Native client restrictions still apply.")
    }
    if (grant) {
      // The grant answered and did not authorize (consumed, expired, or bound
      // to a different request). It never will; stop presenting it.
      await rm(file)
      return decision("deny", `Sanction could not redeem the approval for request ${state.requestId}. This action stays blocked. Retrying opens a new request.`)
    }
    if (result.request_id && (result.status === "escalated" || (result.status === "denied" && result.approval_status === "approved" && !result.would_be))) {
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

export async function runCli() {
  const chunks = []
  let bytes = 0
  try {
    const options = parseArgs(process.argv.slice(2))
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > 65536) throw Error("Hook input too large")
      chunks.push(chunk)
    }
    // No decision is exit 0 with no output, which Claude Code treats as success.
    const result = await runHook(JSON.parse(Buffer.concat(chunks).toString("utf8")), process.env, fetch, options)
    if (result) process.stdout.write(JSON.stringify(result) + "\n")
  } catch { process.stdout.write(JSON.stringify(decision("deny", "Invalid or oversized Sanction hook input.")) + "\n") }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli()
