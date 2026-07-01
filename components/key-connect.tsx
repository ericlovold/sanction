"use client"

import { useState } from "react"
import { ConnectApp } from "@/components/connect-app"

// Per-key "Connect" panel: how to actually wire THIS key into a real agent.
// Three surfaces, one key: the gateway base-URL swap (any LLM SDK), the MCP
// server block (Claude Desktop / Code), and the spend-authorize call. The raw
// key is only shown once at create/rotate, so unless we just rotated we render
// a pxy_YOUR_KEY placeholder and tell the user to drop in the saved value.
function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
    >
      {done ? "copied" : "copy"}
    </button>
  )
}

const SURFACES = ["Gateway / SDK", "Claude (MCP)", "Spend authorize"] as const
type Surface = (typeof SURFACES)[number]

function mcpConfig(key: string): string {
  return `{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["-y", "sanction-mcp"],
      "env": {
        "SANCTION_API_KEY": "${key}",
        "SANCTION_WALLET_ID": "<your wallet id>",
        "SANCTION_API_URL": "https://getsanction.com/api/v1"
      }
    }
  }
}`
}

function authorizeCurl(key: string): string {
  return `curl https://getsanction.com/api/v1/authorize \\
  -H "x-api-key: ${key}" \\
  -H "content-type: application/json" \\
  -d '{"action":"purchase","amount_usd":12.50,"merchant":"openai"}'`
}

export function KeyConnect({ agentKey, hasRealKey }: { agentKey: string; hasRealKey: boolean }) {
  const [surface, setSurface] = useState<Surface>("Gateway / SDK")

  return (
    <div className="mt-3 space-y-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
      {!hasRealKey && (
        <p className="text-[11px] text-zinc-500">
          Keys are shown once. Drop your saved <code className="font-mono text-zinc-400">pxy_</code> value in where you see{" "}
          <code className="font-mono text-zinc-400">pxy_YOUR_KEY</code> — lost it? Rotate above to mint a fresh one.
        </p>
      )}
      <div className="flex flex-wrap gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
        {SURFACES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSurface(s)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              s === surface ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {surface === "Gateway / SDK" && <ConnectApp agentKey={agentKey} showWatch={false} />}

      {surface === "Claude (MCP)" && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            Add this to <code className="font-mono text-zinc-300">claude_desktop_config.json</code> (or your Claude Code MCP
            config). Claude picks up the <code className="font-mono text-zinc-300">sanction</code> tools — authorize, wallet
            status, credential injection — on restart.
          </p>
          <div className="flex items-center justify-end">
            <Copy value={mcpConfig(agentKey)} />
          </div>
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
            <code>{mcpConfig(agentKey)}</code>
          </pre>
        </div>
      )}

      {surface === "Spend authorize" && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            Call this before the agent spends money. Sanction returns approve / escalate / deny against this key&apos;s policy
            and logs it. Under threshold auto-approves; over it escalates to you.
          </p>
          <div className="flex items-center justify-end">
            <Copy value={authorizeCurl(agentKey)} />
          </div>
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
            <code>{authorizeCurl(agentKey)}</code>
          </pre>
        </div>
      )}
    </div>
  )
}
