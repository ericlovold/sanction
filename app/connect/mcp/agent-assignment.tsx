"use client"

import { useActionState, useState } from "react"
import { consentMcpConnection, createMcpAgent, type CreateMcpAgentState } from "./actions"

type Agent = { id: string; name: string }

export function AgentAssignment({ agents, walletId, query }: { agents: Agent[]; walletId: string; query: string }) {
  const [createdAgents, setCreatedAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "")
  const [name, setName] = useState("")
  const [state, createAction, pending] = useActionState(async (previous: CreateMcpAgentState, form: FormData) => {
    const result = await createMcpAgent(previous, form)
    if (result.agent) {
      setCreatedAgents(current => [...current, result.agent!])
      setSelectedId(result.agent.id)
      setName("")
    }
    return result
  }, { error: "" })
  const options = [...agents, ...createdAgents.filter(agent => !agents.some(existing => existing.id === agent.id))]

  return <div className="mt-6 space-y-6">
    <form action={createAction} className="space-y-3 rounded border border-zinc-700 p-4">
      <input type="hidden" name="wallet_id" value={walletId} />
      <label className="block text-sm" htmlFor="new-agent-name">Create a new agent</label>
      <div className="flex flex-wrap gap-3">
        <input id="new-agent-name" name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={64} placeholder="Agent name" className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-900 p-3" />
        <button disabled={pending} className="rounded border border-zinc-600 px-4 py-2 disabled:opacity-40">{pending ? "Creating…" : "Create agent"}</button>
      </div>
      <p className="text-sm text-zinc-400">The new agent inherits your wallet policy. Create it here, then connect it below.</p>
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      {state.agent && <p role="status" className="text-sm text-emerald-400">{state.agent.name} created. Select Connect agent to continue.</p>}
    </form>
    <form action={consentMcpConnection} className="space-y-4">
      <input type="hidden" name="oauth_query" value={query} />
      <label className="block">Agent<select name="agent_id" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={pending || !options.length} className="mt-2 block w-full rounded border border-zinc-600 bg-zinc-900 p-3">
        {!options.length && <option value="">Create an agent above</option>}
        {options.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select></label>
      <div className="flex gap-4"><button name="decision" value="allow" disabled={pending || !selectedId} className="rounded bg-emerald-700 px-5 py-2 disabled:opacity-40">Connect agent</button><button name="decision" value="deny" disabled={pending} className="rounded border border-zinc-600 px-5 py-2 disabled:opacity-40">Cancel</button></div>
    </form>
  </div>
}
