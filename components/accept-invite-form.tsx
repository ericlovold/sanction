"use client"

import { useActionState } from "react"
import { acceptInviteAction, type AcceptInviteState } from "@/app/invite/[token]/actions"

const initial: AcceptInviteState = { error: "" }

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, initial)

  return (
    <form action={formAction} className="mt-8 space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button type="submit" disabled={pending} className="sn-btn sn-btn-primary sn-btn-m w-full disabled:opacity-50">
        {pending ? "Joining…" : "Accept invite"}
      </button>
    </form>
  )
}
