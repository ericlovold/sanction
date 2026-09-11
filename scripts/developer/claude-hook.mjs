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

// Host-installed adapter, not a tamper-proof sandbox. No key or tool input is
// written to disk. One pending request per exact session/tool/input binding.
export async function runHook(input, env = process.env, request = fetch) {
  let lock
  try {
    if (input.hook_event_name !== "PreToolUse" || typeof input.session_id !== "string" || !input.session_id ||
        typeof input.cwd !== "string" || !input.cwd || typeof input.tool_name !== "string" || !input.tool_name || !input.tool_input || typeof input.tool_input !== "object" || Array.isArray(input.tool_input)) throw Error("Invalid hook input")
    const origin = new URL(env.SANCTION_URL || "https://getsanction.com")
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw Error("HTTPS required")
    if (origin.username || origin.password || !env.SANCTION_AGENT_KEY) throw Error("Missing configuration")
    const payload = { tool: `claude-code.${input.tool_name}`, server: "claude-code", arguments: { cwd: input.cwd, input: input.tool_input } }
    const binding = createHash("sha256").update(JSON.stringify(canonical([origin.origin, createHash("sha256").update(env.SANCTION_AGENT_KEY).digest("hex"), input.session_id, payload]))).digest("hex")
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
        headers: { "x-api-key": env.SANCTION_AGENT_KEY, "content-type": "application/json", ...(idempotency ? { "idempotency-key": idempotency } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (response.status >= 500 || response.status === 401) throw Error("Sanction unavailable")
      return response.json()
    }
    let grant
    if (state.requestId) {
      const status = await call(`/api/v1/authorize/${encodeURIComponent(state.requestId)}`)
      grant = status.grant_id
      if (!grant) return decision("deny", `Sanction approval required. Review request ${state.requestId} in the Sanction inbox, then retry this exact action. If denied or expired, remove this pending hook state to request again.`)
    }
    const result = await call("/api/v1/authorize/tool", { ...payload, ...(grant ? { grant_id: grant } : {}) }, grant ? undefined : state.idempotency)
    // Observe mode must not masquerade as an enforced permission decision.
    if (result.authorized === true && result.status === "allowed" && !result.observed && !result.would_be) {
      await rm(file)
      return decision("allow", "Sanction authorized this exact tool request. Native client restrictions still apply.")
    }
    if (result.request_id && !grant) {
      state.requestId = result.request_id
      await writeFile(file, JSON.stringify(state), { mode: 0o600 })
    }
    return decision("deny", result.request_id
      ? `Sanction stopped this action. Review request ${result.request_id} in the Sanction inbox, then retry the exact action.`
      : "Sanction refused this action. Check policy and connection settings.")
  } catch {
    return decision("deny", "Sanction could not verify permission. Action blocked. Check configuration, connectivity, and pending hook locks.")
  } finally {
    if (lock) await rm(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = ""
  try {
    for await (const chunk of process.stdin) {
      raw += chunk
      if (Buffer.byteLength(raw) > 65536) throw Error("Hook input too large")
    }
    process.stdout.write(JSON.stringify(await runHook(JSON.parse(raw))) + "\n")
  } catch { process.stdout.write(JSON.stringify(decision("deny", "Invalid or oversized Sanction hook input.")) + "\n") }
}
