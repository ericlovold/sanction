import Link from "next/link"
import { getViewWallet } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { ClaudeCodeSeat } from "@/components/claude-code-seat"
import { CLAUDE_CODE_GATED } from "@/lib/claudeCodePlugin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Approvals for Claude Code | Sanction" }

const PATH = "/dashboard/connect/claude-code"

export default async function ClaudeCodeConnectPage() {
  const wallet = await getViewWallet()
  if (!wallet?.isSession) {
    return <div className="mx-auto max-w-3xl space-y-4 p-5 md:p-10">
      <h1 className="text-2xl font-semibold">Approvals for Claude Code</h1>
      <p className="text-sm text-muted-foreground">Create a seat in your own wallet, then install the plugin.</p>
      <Link className="inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={`/login?next=${encodeURIComponent(PATH)}`}>Sign in or create a wallet</Link>
    </div>
  }
  return <div className="home" style={{ maxWidth: 820 }}>
    <Link href="/dashboard/connect" className="home-link">Back to developer tools</Link>
    <h1 className="home-title mt-3">Approvals for Claude Code</h1>
    <p className="home-sub">Pause risky shell commands in Claude Code until someone in {wallet.name} approves the exact command.</p>
    <p className="mt-3 text-sm">The plugin pauses {CLAUDE_CODE_GATED.map((command, index) => <span key={command}>{index > 0 && (index === CLAUDE_CODE_GATED.length - 1 ? " and " : ", ")}<code>{command}</code></span>)}. Everything else runs as usual.</p>
    {hasRole(wallet.role, "admin")
      ? <ClaudeCodeSeat />
      : <p className="g-panel home-section p-5 text-sm">Ask a wallet admin to create a dedicated seat and send you its key. Your viewer role cannot create seats.</p>}
    <section className="g-panel home-section space-y-2 p-5">
      <h2 className="home-h2">Limits</h2>
      <ul className="add-pop-note list-disc space-y-1 pl-5">
        <li>Not a sandbox. Whoever controls this machine&rsquo;s Claude Code settings can disable the plugin.</li>
        <li>Matching is best-effort. Words assembled from variables, aliases, wrapper scripts and tools outside the list (<code>pnpm publish</code>) are not caught.</li>
        <li>If Sanction is unreachable, a command on the list is blocked.</li>
        <li>If this wallet&rsquo;s policy has a tool allow-list, it must include <code>claude-code.Bash</code>, or the command is refused and cannot be approved.</li>
        <li>An approval shows the command was permitted. It does not prove the command ran.</li>
      </ul>
      <Link href="/docs/developer-usage" className="home-link inline-block">Full setup and limits</Link>
    </section>
  </div>
}
