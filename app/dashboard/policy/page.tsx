import type { Metadata } from "next"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { PackPicker } from "@/components/pack-picker"
import { PolicyEditor } from "@/components/policy-editor"
import { policyToDollars } from "@/lib/policy"
import { getViewWallet } from "@/lib/session"
import { policySummary } from "@/lib/policySummary"
import { hasRole } from "@/lib/roles"
import { policyLayerChain } from "@/lib/inheritance"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Policy",
  description: "What your agents may spend and use, and when a person is asked.",
}

// The full policy surface — the 15 governed fields the decision engine reads.
// (Provision resource lists are not in policyInputSchema yet, so they're not
// editable here; that's a follow-up, not console parity v1.)
export default async function PolicyPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const wallet = await db.wallet.findUnique({ where: { id: view.id }, include: { policy: true } })

  // INHERIT-1: rules inherited from ancestor wallets bind this wallet's agents
  // and are not editable here — they are shown so a denial that names a parent
  // reads as governance, not as a bug. Ancestors only (own policy is the editor).
  const ancestorLayers = wallet?.policy
    ? (
        await policyLayerChain(db, { id: wallet.id, parentId: wallet.parentId, policy: wallet.policy })
      ).slice(0, -1)
    : []
  // Zero-noise: an ancestor with nothing to say adds nothing here — the chain
  // is still consulted at decision time either way.
  const inheritedLayers = ancestorLayers.filter(
    (l) => l.blockedTools.length > 0 || l.escalateTools.length > 0 || l.allowedTools.length > 0 || l.capabilityRules.length > 0 || l.toolConditions.length > 0,
  )
  const layerNames = new Map(
    inheritedLayers.length > 0
      ? (
          await db.wallet.findMany({ where: { id: { in: inheritedLayers.map((l) => l.walletId) } }, select: { id: true, name: true } })
        ).map((w) => [w.id, w.name] as const)
      : [],
  )

  const canEdit = hasRole(view.role, "admin")
  const dollars = wallet?.policy ? policyToDollars(wallet.policy) : null

  return (
    <div className="home pol-page">
      <header>
        <h1 className="home-title">Policy</h1>
        <p className="home-sub">{view.name}</p>
        <p className="appr-lede">
          Checked before an agent spends, uses a tool or takes on a new capability. Every saved change is a numbered
          revision that past decisions can be replayed against.
        </p>
      </header>

      {dollars ? (
        <section className="home-section" aria-labelledby="pol-now">
          <h2 id="pol-now" className="home-h2">What happens now</h2>
          <ul className="pol-now g-glass">
            {policySummary(dollars).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="wait-none home-section">
          This wallet has no policy yet, so there are no limits to enforce. Pick a template below to start; every field
          stays editable afterwards.
        </p>
      )}

      {/* Inherited constraints: read-only by design; edited on the parent. */}
      {inheritedLayers.length > 0 && (
        <section className="home-section" aria-labelledby="pol-inherited">
          <h2 id="pol-inherited" className="home-h2">Set by a wallet above this one</h2>
          <p className="pol-lede">
            These rules apply to every agent here and cannot be loosened on this page. Change them on the wallet that
            owns them.
          </p>
          <div className="g-panel">
            {inheritedLayers.map((l) => {
              const caps = l.capabilityRules.length
              const conds = l.toolConditions.length
              const parts = [
                l.blockedTools.length > 0 && `blocks ${l.blockedTools.join(", ")}`,
                l.escalateTools.length > 0 && `asks a person for ${l.escalateTools.join(", ")}`,
                l.allowedTools.length > 0 && `allows only ${l.allowedTools.length} named tool${l.allowedTools.length === 1 ? "" : "s"}`,
                caps > 0 && `${caps} capability rule${caps === 1 ? "" : "s"}`,
                conds > 0 && `${conds} conditional rule${conds === 1 ? "" : "s"}`,
              ].filter(Boolean)
              return (
                <div key={l.walletId} className="dec-row">
                  <div style={{ minWidth: 0 }}>
                    <p className="set-title">{layerNames.get(l.walletId) ?? l.walletId}</p>
                    <p className="set-body">{parts.join("; ")}</p>
                  </div>
                  <span className="dec-grant">revision {l.revision}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {dollars && (
        <PolicyEditor
          policy={dollars}
          editable={canEdit}
          readOnlyNote={
            view.isSession ? "Your role can view this policy but not change it. Ask the wallet owner for admin access." : undefined
          }
        />
      )}

      <section className="home-section">
        <PackPicker editable={canEdit} previewable={view.isSession} startOpen={!dollars} />
      </section>
    </div>
  )
}
