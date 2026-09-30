import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth-config"
import { db } from "@/lib/db"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"
import { mcpOAuthQuery } from "@/lib/mcpOAuthQuery"
import { consentMcpConnection, revokeMcpConnection } from "./actions"

export const dynamic = "force-dynamic"
export default async function ConnectMcpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!mcpOAuthEnabled()) notFound()
  const query = mcpOAuthQuery(await searchParams)
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect(`/connect/mcp/login${query ? `?${query}` : ""}`)
  const member = await getSessionMember()
  const allowed = member && member.actor.type === "user" && member.actor.userId === session.user.id && hasRole(member.role, "admin") && session.user.emailVerified
  if (!allowed) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl">Wallet administrator required</h1><p className="mt-4">Sign in with a verified account that owns or administers this wallet.</p><Link href="/dashboard">Return to Sanction</Link></main>
  const params = new URLSearchParams(query)
  const clientId = params.get("client_id")
  const client = clientId ? await auth.api.getOAuthClientPublic({ headers: await headers(), query: { client_id: clientId } }) : null
  const agents = await db.agent.findMany({ where: { walletId: member.wallet.id, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } })
  const connections = await db.mcpOAuthConnection.findMany({ where: { walletId: member.wallet.id, revokedAt: null }, orderBy: { createdAt: "desc" } })
  const clients = await db.oauthClient.findMany({ where: { clientId: { in: connections.map(connection => connection.clientId) } }, select: { clientId: true, name: true } })
  return <main className="mx-auto max-w-2xl px-6 py-12 text-zinc-200">
    <Link href="/dashboard" className="text-sm text-zinc-400">Sanction / {member.wallet.name}</Link>
    <h1 className="mt-6 text-3xl font-semibold">{client ? "Connect an agent" : "Connected hosts"}</h1>
    {client && <section className="mt-6 rounded-lg border border-zinc-700 p-6">
      <p className="text-lg">{client.client_name || clientId} is requesting access.</p>
      <p className="mt-2 break-all text-sm text-zinc-400">Client identifier: {clientId}</p>
      <p className="mt-4">This host can request spend, tool and capability decisions, record usage and outcomes, and check budgets and approvals for the agent you select. Your wallet policy still applies.</p>
      <p className="mt-3 text-sm text-zinc-400">It cannot retrieve vault credentials or issue execution tokens through this connection. Approval requests can notify you. The host must ask Sanction before acting; connecting does not intercept its other tools.</p>
      {params.get("scope")?.split(" ").includes("offline_access") && <p className="mt-3 text-sm text-zinc-400">The host can renew access until you disconnect it.</p>}
      <form action={consentMcpConnection} className="mt-6 space-y-4">
        <input type="hidden" name="oauth_query" value={query} />
        <label className="block">Agent<select name="agent_id" className="mt-2 block w-full rounded border border-zinc-600 bg-zinc-900 p-3">{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        {!agents.length && <p>Create an active agent in your <Link href="/dashboard" className="underline">roster</Link> first.</p>}
        <div className="flex gap-4"><button name="decision" value="allow" disabled={!agents.length} className="rounded bg-emerald-700 px-5 py-2 disabled:opacity-40">Connect agent</button><button name="decision" value="deny" className="rounded border border-zinc-600 px-5 py-2">Cancel</button></div>
      </form>
    </section>}
    <h2 className="mt-10 text-xl">Active connections</h2>
    <p className="mt-2 text-sm text-zinc-400">Disconnect stops future requests immediately. It does not undo decisions already made.</p>
    {connections.length ? connections.map(connection => <form action={revokeMcpConnection} key={connection.id} className="mt-4 flex items-center justify-between gap-4 rounded border border-zinc-700 p-4">
      <input type="hidden" name="connection_id" value={connection.id} /><div className="min-w-0"><p className="break-all">{clients.find(client => client.clientId === connection.clientId)?.name ?? connection.clientId}</p><p className="text-sm text-zinc-400">{agents.find(agent => agent.id === connection.agentId)?.name ?? "Inactive agent"}</p></div><button className="rounded border border-zinc-600 px-3 py-2">Disconnect</button>
    </form>) : <p className="mt-4 text-zinc-400">No active connections.</p>}
  </main>
}
