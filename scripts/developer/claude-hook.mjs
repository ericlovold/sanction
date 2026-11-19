#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { runCli } from "../../claude-plugin/hooks/claude-hook.mjs"

export { runHook } from "../../claude-plugin/hooks/claude-hook.mjs"

// Private Claude settings can point at this path across checkout upgrades.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
