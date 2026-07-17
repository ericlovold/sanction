import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// Structural ratchet for the WALLET-MEMBERS role floor: no dashboard server
// action may gate a mutation on the bare getSessionWallet() — that resolves
// ANY signed-in member, viewer included. Mutations go through
// requireSessionRole (or getSessionMember with an explicit role check, as the
// team actions do). The only sanctioned getSessionWallet call sites in the
// dashboard are the two read-only policy replays, which are deliberately open
// to every role.
//
// This test reads the source, not the runtime — it exists so the NEXT
// actions.ts file (or the next mutation added to an existing one) fails CI
// loudly instead of silently shipping viewer-writable.

const DASHBOARD = join(__dirname, "..", "app", "dashboard")

// file (relative to app/dashboard) → number of permitted getSessionWallet calls
const SANCTIONED: Record<string, number> = {
  // previewPackAction + simulateDraftAction: read-only replays, open to viewers.
  "policy/actions.ts": 2,
}

function actionFiles(dir: string, prefix = ""): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) out.push(...actionFiles(full, rel))
    else if (entry === "actions.ts") out.push(rel)
  }
  return out
}

describe("role-floor structure — dashboard actions never gate on bare getSessionWallet", () => {
  const files = actionFiles(DASHBOARD)

  it("finds the action files at all (the ratchet has teeth)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  for (const rel of files) {
    it(`${rel} stays behind the role floor`, () => {
      const src = readFileSync(join(DASHBOARD, rel), "utf8")
      const calls = (src.match(/\bgetSessionWallet\s*\(/g) ?? []).length
      const permitted = SANCTIONED[rel] ?? 0
      expect(
        calls,
        `${rel} calls getSessionWallet() ${calls}× (permitted: ${permitted}). ` +
          "Mutations must use requireSessionRole (or getSessionMember + an explicit role check); " +
          "if this is a deliberate read-only action open to viewers, add it to SANCTIONED with a comment.",
      ).toBe(permitted)
    })
  }
})
