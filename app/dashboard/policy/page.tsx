import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { PolicyEditor } from "@/components/policy-editor"
import { policyToDollars } from "@/lib/policy"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Policy",
  description: "Author the wallet's governance policy: budgets, categories, tools, capability rules, escalation.",
}

// The full policy surface — the 15 governed fields the decision engine reads.
// (Provision resource lists are not in policyInputSchema yet, so they're not
// editable here; that's a follow-up, not console parity v1.)
export default async function PolicyPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const wallet = await db.wallet.findUnique({ where: { id: view.id }, include: { policy: true } })

  return (
    <div className="min-h-screen max-w-4xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-100">Policy</h1>
        <p className="mt-1 text-sm text-zinc-500">
          One decision engine governs spend, tools, and capability. Everything here is checked before an agent acts,
          and every change is a replayable revision.
        </p>
      </div>

      {wallet?.policy ? (
        <PolicyEditor policy={policyToDollars(wallet.policy)} editable={view.isSession} />
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="px-5 py-5">
            <p className="text-sm text-zinc-600">No policy configured for this wallet yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
