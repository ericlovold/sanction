import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth-config"
import { db } from "@/lib/db"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"
import { mcpOAuthQuery } from "@/lib/mcpOAuthQuery"
import { revokeMcpConnection } from "./actions"
import { AgentAssignment } from "./agent-assignment"

function Can({ children }: { children: React.ReactNode }) {
  return <li><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="var(--pine-7)" strokeWidth="2.2"><path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{children}</span></li>
}
function Cannot({ children }: { children: React.ReactNode }) {
  return <li><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="var(--status-denied)" strokeWidth="2.2"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg><span>{children}</span></li>
}

export const dynamic = "force-dynamic"
export default async function ConnectMcpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!mcpOAuthEnabled()) notFound()
  const query = mcpOAuthQuery(await searchParams)
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect(`/connect/mcp/login${query ? `?${query}` : ""}`)
  const member = await getSessionMember()
  const allowed = member && member.actor.type === "user" && member.actor.userId === session.user.id && hasRole(member.role, "admin") && session.user.emailVerified
  if (!allowed) return <>
    <h1>Wallet administrator required</h1>
    <p className="sn-connect-secondary">Sign in with a verified account that owns or administers this wallet.</p>
    <p><Link href="/dashboard">Return to Sanction</Link></p>
  </>
  const params = new URLSearchParams(query)
  const clientId = params.get("client_id")
  const client = clientId ? await auth.api.getOAuthClientPublic({ headers: await headers(), query: { client_id: clientId } }) : null
  const agents = await db.agent.findMany({ where: { walletId: member.wallet.id, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } })
  const connections = await db.mcpOAuthConnection.findMany({ where: { walletId: member.wallet.id, revokedAt: null }, orderBy: { createdAt: "desc" } })
  const clients = await db.oauthClient.findMany({ where: { clientId: { in: connections.map(connection => connection.clientId) } }, select: { clientId: true, name: true } })
  const renews = params.get("scope")?.split(" ").includes("offline_access")
  return <>
    <Link href="/dashboard" className="sn-connect-crumb">Sanction / {member.wallet.name}</Link>
    {client ? <>
      <div className="sn-connect-field">
        <h1>Connect this tool to Sanction?</h1>
        <p className="sn-connect-secondary"><span className="sn-connect-host">{(client.client_name || clientId || "").slice(0, 80)}</span> is asking to request decisions on behalf of one of your agents. Your wallet policy still applies to everything it asks.</p>
        <p className="sn-connect-id">The tool supplied that name. Client identifier: {clientId}</p>
      </div>
      <AgentAssignment key={member.wallet.id} agents={agents} walletId={member.wallet.id} query={query}>
        <div className="sn-connect-scopes">
          <section className="sn-connect-card">
            <h2>It will be able to</h2>
            <ul>
              <Can>Ask for decisions on spend, tools and new capabilities</Can>
              <Can>Check budgets and the status of its approvals</Can>
              <Can>Record usage and outcomes</Can>
              {renews && <Can>Renew its access until you disconnect it</Can>}
            </ul>
          </section>
          <section className="sn-connect-card">
            <h2>It won&apos;t be able to</h2>
            <ul>
              <Cannot>Retrieve credentials from your vault</Cannot>
              <Cannot>Issue execution tokens</Cannot>
              <Cannot>Approve its own requests</Cannot>
            </ul>
          </section>
        </div>
        <p className="sn-connect-caveat">The tool has to ask Sanction before it acts. Connecting does not intercept its other tools. Approval requests can notify you.</p>
      </AgentAssignment>
      <p className="sn-connect-small">You can disconnect it at any time below. Disconnecting stops future requests immediately. It does not undo decisions already made.</p>
    </> : <>
      <h1>Connected hosts</h1>
      <p className="sn-connect-secondary">AI tools that can request decisions for your agents. Disconnecting stops future requests immediately. It does not undo decisions already made.</p>
    </>}
    <section className="sn-connect-list" aria-labelledby="active-connections">
      <h2 id="active-connections">Active connections</h2>
      {connections.length ? connections.map(connection => <form action={revokeMcpConnection} key={connection.id} className="sn-connect-connection">
        <input type="hidden" name="connection_id" value={connection.id} />
        <div><p className="sn-connect-host">{clients.find(client => client.clientId === connection.clientId)?.name ?? connection.clientId}</p><p className="sn-connect-small">{agents.find(agent => agent.id === connection.agentId)?.name ?? "Inactive agent"}</p></div>
        <button className="sn-btn sn-btn-secondary sn-btn-m">Disconnect</button>
      </form>) : <p className="sn-connect-secondary">No active connections.</p>}
    </section>
  </>
}
