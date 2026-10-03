#!/usr/bin/env node
import { open } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runReviewerEvidence, validateLoopbackApiUrl, ReviewerHarnessError } from "./harness"

export function parseReviewerArgs(args: string[]) {
  const options: { apiUrl?: string; output?: string; timeoutMs?: number } = {}
  const seen = new Set<string>()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    if (!["--api-url", "--output", "--timeout-ms"].includes(flag) || seen.has(flag) || !value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS")
    seen.add(flag)
    if (flag === "--api-url") options.apiUrl = validateLoopbackApiUrl(value)
    if (flag === "--output") options.output = value
    if (flag === "--timeout-ms") {
      const timeout = Number(value)
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error("INVALID_ARGUMENTS")
      options.timeoutMs = timeout
    }
  }
  return options
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  let output: Awaited<ReturnType<typeof open>> | undefined
  try {
    const options = parseReviewerArgs(args)
    // Validate and reserve an exclusive owner-only output before creating rows.
    validateLoopbackApiUrl(options.apiUrl ?? "http://127.0.0.1:3000/api/v1")
    if (options.output) output = await open(options.output, "wx", 0o600)
    const report = await runReviewerEvidence(options)
    const json = JSON.stringify(report, null, 2) + "\n"
    if (output) await output.writeFile(json)
    else process.stdout.write(json)
    return report.overall === "passed" ? 0 : 1
  } catch (error) {
    // No raw exception messages, request URLs, headers or backend bodies.
    const code = error instanceof ReviewerHarnessError ? error.code : "CLI_FAILED"
    process.stderr.write(`Reviewer harness stopped: ${code}. No automatic retry; inspect any retained fixture before another run.\n`)
    return 1
  } finally {
    await output?.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main()
}
