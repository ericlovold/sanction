// Finds the session files the parsers may read, and nothing else.
//
// The collector never walks a home directory. It looks only inside each
// tool's own data folder, only at the file shapes listed here, and only at
// files changed since the last scan. Credentials, history and state databases
// live in the same folders (Codex auth.json, history.jsonl, state_*.sqlite;
// Claude Code's .claude.json) and are never opened, because no rule below
// matches them. Symlinks are skipped so a link cannot point a scan elsewhere.

import { closeSync, lstatSync, openSync, readdirSync, readSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { CollectorTool } from "./record"

export type Env = Record<string, string | undefined>

export type Found = {
  tool: CollectorTool
  files: string[]
  // Files that match a session shape this version cannot read yet, such as
  // Codex's compressed rollouts. Counted so the server sees the gap.
  skippedFiles: number
}

/** Claude Code: CLAUDE_CONFIG_DIR, else ~/.claude and the XDG location. */
export function claudeCodeRoots(env: Env = process.env, home = homedir()): string[] {
  if (env.CLAUDE_CONFIG_DIR) return [resolve(env.CLAUDE_CONFIG_DIR)]
  const xdg = env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(home, ".config")
  return unique([join(home, ".claude"), join(xdg, "claude")])
}

/** Codex: CODEX_HOME, else ~/.codex. */
export function codexRoots(env: Env = process.env, home = homedir()): string[] {
  return [env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(home, ".codex")]
}

const unique = (xs: string[]) => [...new Set(xs)]

type Entry = { name: string; dir: boolean; file: boolean }

function list(dir: string): Entry[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.isSymbolicLink())
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((d) => ({ name: d.name, dir: d.isDirectory(), file: d.isFile() }))
  } catch {
    return []
  }
}

function changedSince(path: string, since: Date | null): boolean {
  if (!since) return true
  try {
    return lstatSync(path).mtimeMs >= since.getTime()
  } catch {
    return false
  }
}

const UUID_JSONL = /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}\.jsonl$/

/**
 * <root>/projects/<project>/<session>.jsonl and
 * <root>/projects/<project>/<session>/subagents/<agent>.jsonl
 *
 * Returned a whole session at a time: when any of a session's files changed,
 * all of them are read again. The server replaces each (session, hour) total,
 * so a partial re-read would lower a total instead of correcting it.
 */
export function findClaudeCode(roots: string[], since: Date | null = null): Found {
  const files: string[] = []
  for (const root of roots) {
    const projects = join(root, "projects")
    for (const project of list(projects)) {
      if (!project.dir) continue
      const pdir = join(projects, project.name)
      const sessions = new Map<string, string[]>()
      const add = (session: string, path: string) => sessions.set(session, [...(sessions.get(session) ?? []), path])
      for (const entry of list(pdir)) {
        if (entry.file && UUID_JSONL.test(entry.name)) {
          add(entry.name.slice(0, -".jsonl".length), join(pdir, entry.name))
        } else if (entry.dir) {
          const sub = join(pdir, entry.name, "subagents")
          for (const agent of list(sub)) {
            if (agent.file && UUID_JSONL.test(agent.name)) add(entry.name, join(sub, agent.name))
          }
        }
      }
      for (const paths of sessions.values()) {
        if (paths.some((p) => changedSince(p, since))) files.push(...paths)
      }
    }
  }
  return { tool: "claude_code", files, skippedFiles: 0 }
}

const ROLLOUT = /^rollout-[0-9T:-]{10,32}-[A-Za-z0-9-]{8,64}\.jsonl$/
const ROLLOUT_ZST = /^rollout-.*\.jsonl\.zst$/
const DIGITS = /^[0-9]{2,4}$/

/**
 * <root>/sessions/YYYY/MM/DD/rollout-*.jsonl and
 * <root>/archived_sessions/rollout-*.jsonl
 */
export function findCodex(roots: string[], since: Date | null = null): Found {
  const files: string[] = []
  let skippedFiles = 0
  const take = (dir: string) => {
    for (const f of list(dir)) {
      if (!f.file) continue
      const p = join(dir, f.name)
      if (ROLLOUT.test(f.name)) {
        if (changedSince(p, since)) files.push(p)
      } else if (ROLLOUT_ZST.test(f.name) && changedSince(p, since)) {
        skippedFiles++
      }
    }
  }
  for (const root of roots) {
    const sessions = join(root, "sessions")
    for (const y of list(sessions)) {
      if (!y.dir || !DIGITS.test(y.name)) continue
      for (const m of list(join(sessions, y.name))) {
        if (!m.dir || !DIGITS.test(m.name)) continue
        for (const d of list(join(sessions, y.name, m.name))) {
          if (d.dir && DIGITS.test(d.name)) take(join(sessions, y.name, m.name, d.name))
        }
      }
    }
    take(join(root, "archived_sessions"))
  }
  return { tool: "codex", files, skippedFiles }
}

/**
 * A file's lines, read in chunks so a large transcript is never held in
 * memory whole. A line longer than maxLine (a huge tool result) is dropped
 * without being parsed: usage lines are small, so nothing useful is lost.
 */
export function* readLines(path: string, maxLine = 4 * 1024 * 1024): Generator<string> {
  const fd = openSync(path, "r")
  try {
    const buf = Buffer.alloc(64 * 1024)
    let carry: Buffer[] = []
    let carryLen = 0
    let oversized = false
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      let start = 0
      for (let i = 0; i < n; i++) {
        if (buf[i] !== 0x0a) continue
        if (!oversized) {
          carry.push(buf.subarray(start, i))
          yield Buffer.concat(carry).toString("utf8")
        }
        carry = []
        carryLen = 0
        oversized = false
        start = i + 1
      }
      if (start < n && !oversized) {
        carry.push(Buffer.from(buf.subarray(start, n)))
        carryLen += n - start
        if (carryLen > maxLine) {
          oversized = true
          carry = []
          carryLen = 0
        }
      }
    }
    if (carry.length && !oversized) yield Buffer.concat(carry).toString("utf8")
  } finally {
    closeSync(fd)
  }
}
