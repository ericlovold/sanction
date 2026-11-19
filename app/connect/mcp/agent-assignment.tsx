"use client"

import { useActionState, useId, useState } from "react"
import { consentMcpConnection, createMcpAgent, type CreateMcpAgentState } from "./actions"

type Agent = { id: string; name: string }

// The decision form. `children` is the summary of what the connection allows,
// shown between the agent choice and the buttons so it is read before deciding.
export function AgentAssignment({ agents, walletId, query, children }: { agents: Agent[]; walletId: string; query: string; children?: React.ReactNode }) {
  const [createdAgents, setCreatedAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(agents.length === 0)
  const createForm = useId()
  const [state, createAction, pending] = useActionState(async (previous: CreateMcpAgentState, form: FormData) => {
    const result = await createMcpAgent(previous, form)
    if (result.agent) {
      setCreatedAgents(current => [...current, result.agent!])
      setSelectedId(result.agent.id)
      setName("")
      setCreating(false)
    }
    return result
  }, { error: "" })
  const options = [...agents, ...createdAgents.filter(agent => !agents.some(existing => existing.id === agent.id))]

  return <>
    {/* Forms cannot nest: the create fields below join this one by its id. */}
    <form id={createForm} action={createAction}><input type="hidden" name="wallet_id" value={walletId} /></form>
    <form action={consentMcpConnection} className="sn-connect-form">
      <input type="hidden" name="oauth_query" value={query} />
      <div className="sn-connect-field">
        <label htmlFor="connect-agent">Which agent will this tool act as?</label>
        <select id="connect-agent" name="agent_id" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={pending || !options.length}>
          {!options.length && <option value="">Create an agent first</option>}
          {options.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <p className="sn-connect-small">Requests, budgets and the decision record are kept under this agent&apos;s name.</p>
        {state.agent && !creating && <p role="status" className="sn-connect-ok">{state.agent.name} created and selected.</p>}
        {creating ? <div className="sn-connect-create sn-connect-field">
          <label htmlFor="new-agent-name">New agent name</label>
          <div className="sn-connect-row">
            <input id="new-agent-name" type="text" name="name" form={createForm} value={name} onChange={event => setName(event.target.value)} required maxLength={64} />
            <button type="submit" form={createForm} disabled={pending} className="sn-btn sn-btn-secondary sn-btn-m" style={{ height: 48 }}>{pending ? "Creating…" : "Create agent"}</button>
          </div>
          <p className="sn-connect-small">The new agent inherits your wallet policy.</p>
          {state.error && <p role="alert" className="sn-connect-error">{state.error}</p>}
        </div> : <button type="button" className="sn-connect-link" onClick={() => setCreating(true)}>Create a new agent</button>}
      </div>
      {children}
      <div className="sn-connect-actions">
        <button name="decision" value="allow" disabled={pending || !selectedId} className="sn-btn sn-btn-primary sn-btn-l">Allow connection</button>
        <button name="decision" value="deny" formNoValidate disabled={pending} className="sn-btn sn-btn-secondary sn-btn-l">Deny</button>
      </div>
    </form>
  </>
}
