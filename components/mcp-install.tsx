"use client"

import { useMemo, useState } from "react"

// One-click "Add Sanction" buttons. Everything here is pure client-side string
// building — the key and wallet id never leave the browser; the deeplinks are
// generated locally and open the user's own editor.
//
// Link formats (verified against vendor docs):
//   Cursor:  cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64(JSON)
//   VS Code: vscode:mcp/install?$URLENCODED({name, command, args, env})
//   Claude Code / Desktop: copy a CLI command / a JSON config block.

const KEY_PLACEHOLDER = "pxy_YOUR_AGENT_KEY"
const WALLET_PLACEHOLDER = "YOUR_WALLET_ID"

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="rounded border border-input px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-foreground">{text}</pre>
    </div>
  )
}

export function McpInstall() {
  const [apiKey, setApiKey] = useState("")
  const [walletId, setWalletId] = useState("")

  const { cursorHref, vscodeHref, claudeCmd, desktopJson, usingPlaceholders } = useMemo(() => {
    const key = apiKey.trim() || KEY_PLACEHOLDER
    const wallet = walletId.trim() || WALLET_PLACEHOLDER
    const env = { SANCTION_API_KEY: key, SANCTION_WALLET_ID: wallet }
    const server = { command: "npx", args: ["-y", "sanction-mcp"], env }

    return {
      cursorHref: `cursor://anysphere.cursor-deeplink/mcp/install?name=sanction&config=${btoa(JSON.stringify(server))}`,
      vscodeHref: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "sanction", ...server }))}`,
      claudeCmd: `claude mcp add sanction --env SANCTION_API_KEY=${key} --env SANCTION_WALLET_ID=${wallet} -- npx -y sanction-mcp`,
      desktopJson: JSON.stringify({ mcpServers: { sanction: server } }, null, 2),
      usingPlaceholders: !apiKey.trim() || !walletId.trim(),
    }
  }, [apiKey, walletId])

  const btn =
    "inline-flex items-center justify-center rounded-md border border-input px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-signal/50 hover:text-signal"

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Agent API key</span>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="pxy_…"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Wallet ID</span>
          <input
            value={walletId}
            onChange={(e) => setWalletId(e.target.value)}
            placeholder="from your dashboard URL or wallet settings"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Generated in your browser — the key never leaves this page.
        {usingPlaceholders && " Leave blank to install with placeholders and paste your key into the config afterwards."}
      </p>

      <div className="flex flex-wrap gap-2">
        <a href={cursorHref} className={btn}>
          Add to Cursor
        </a>
        <a href={vscodeHref} className={btn}>
          Add to VS Code
        </a>
      </div>

      <CopyBlock label="Claude Code" text={claudeCmd} />
      <CopyBlock label="Claude Desktop / any MCP client (claude_desktop_config.json)" text={desktopJson} />
    </div>
  )
}
