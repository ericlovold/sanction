export type InternalAgentIdentity = Readonly<{ agentId: string; walletId: string }>

// Only an in-process caller can bind identity. Headers, copies, and concurrent
// requests cannot inherit the authority attached to this exact request object.
const identities = new WeakMap<Request, InternalAgentIdentity>()

export function bindInternalAgentIdentity(request: Request, identity: InternalAgentIdentity): void {
  if (identities.has(request)) throw new Error("Request identity is already bound")
  if (!identity.agentId || !identity.walletId) throw new Error("Missing internal agent identity")
  identities.set(request, Object.freeze({ agentId: identity.agentId, walletId: identity.walletId }))
}

export function internalAgentIdentity(request: Request): InternalAgentIdentity | undefined {
  return identities.get(request)
}
