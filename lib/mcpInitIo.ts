import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { InitIo, RunResult } from "./mcpInit"

/** The real terminal, browser and network behind `runInit`. */
export function nodeIo(): InitIo {
  const run = (command: string, args: string[], input?: string) => new Promise<RunResult>((resolve) => {
    // Arguments are fixed strings from mcpInit; on Windows `claude` is a .cmd
    // shim, which only resolves through the shell.
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: stderr || String(error) }))
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.on("error", () => { /* the child closed stdin first; its exit code tells the story */ })
    child.stdin.end(input ?? "")
  })

  const ask = (question: string) => new Promise<string>((resolve) => {
    const lines = createInterface({ input: process.stdin, output: process.stdout })
    lines.question(question, (answer) => { lines.close(); resolve(answer) })
  })

  // Raw mode so nothing typed or pasted is echoed. Ctrl-C still stops the run.
  const askSecret = (question: string) => new Promise<string>((resolve) => {
    const input = process.stdin
    process.stdout.write(question)
    input.setRawMode(true)
    input.resume()
    let value = ""
    const done = (result: string) => {
      input.setRawMode(false)
      input.pause()
      input.off("data", onData)
      process.stdout.write("\n")
      resolve(result)
    }
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") { done(""); process.exit(130) }
        if (char === "\r" || char === "\n") return done(value)
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1)
        else if (char >= " ") value += char
      }
    }
    input.on("data", onData)
  })

  const open = async (url: string) => {
    const [command, args] = process.platform === "darwin" ? ["open", [url]]
      : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]]
    return new Promise<boolean>((resolve) => {
      const child = spawn(command, args, { stdio: "ignore" })
      child.on("error", () => resolve(false))
      child.on("close", (code) => resolve(code === 0))
    })
  }

  const check = async (url: string, key: string) => {
    try {
      const response = await fetch(url, { headers: { "x-api-key": key }, redirect: "error", signal: AbortSignal.timeout(8000) })
      return response.status
    } catch {
      return 0
    }
  }

  return {
    run, ask, askSecret, open, check,
    print: (line) => process.stdout.write(line + "\n"),
    env: process.env,
    nodeVersion: process.version,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  }
}
