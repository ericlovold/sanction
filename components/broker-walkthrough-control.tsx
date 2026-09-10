"use client"
import { useActionState } from "react"
import { walkthroughAction } from "@/app/dashboard/walkthrough/actions"
export function BrokerWalkthroughControl({ operation, id, label }: { operation: "start" | "advance"; id?: string; label: string }) {
  const [state, action, pending] = useActionState(walkthroughAction, {})
  return <form action={action} className="space-y-2">
    <input type="hidden" name="operation" value={operation} />
    {id && <input type="hidden" name="id" value={id} />}
    <button disabled={pending} className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50">{pending ? "Checking…" : label}</button>
    {state.error && <p role="alert" className="text-sm text-red-500">{state.error}</p>}
  </form>
}
