"use client"

import { useActionState } from "react"
import { ActionFlash } from "@/components/ui/action-flash"
import { connectUsageToolAction, syncUsageToolNowAction, type ConnectState } from "./actions"

const initial: ConnectState = { ok: false, message: "" }

// The key field is write-only: it posts to the server action and nothing ever
// sends a stored key back to the browser.
export function ConnectToolForm({
  provider,
  name,
  rekey,
  keyNoun = "API key",
  account,
}: {
  provider: string
  name: string
  rekey: boolean
  keyNoun?: string
  // Asked for when the key alone does not name the account to read.
  account?: { label: string; placeholder: string; current: string | null }
}) {
  const [state, action, pending] = useActionState(connectUsageToolAction, initial)
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="provider" value={provider} />
      {account && (
        <input
          name="account_ref"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          aria-label={account.label}
          placeholder={`${account.label}, for example ${account.placeholder}`}
          defaultValue={account.current ?? ""}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        />
      )}
      <div className="flex gap-2">
        <input
          name="api_key"
          type="password"
          required
          autoComplete="off"
          aria-label={`${name} ${keyNoun}`}
          placeholder={rekey ? `Paste a new ${keyNoun} to replace the stored one` : `Paste your ${name} ${keyNoun}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? `Checking ${keyNoun} and pulling history` : rekey ? `Replace ${keyNoun}` : `Connect ${name}`}
        </button>
      </div>
      {pending && <p className="text-xs text-muted-foreground">Reading up to 30 days of usage. This can take a minute.</p>}
      <ActionFlash state={state} successMs={15000} />
    </form>
  )
}

export function SyncNowForm({ connectionId }: { connectionId: string }) {
  const [state, action, pending] = useActionState(syncUsageToolNowAction, initial)
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="connection_id" value={connectionId} />
      <button type="submit" disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60">
        {pending ? "Pulling" : "Pull now"}
      </button>
      <ActionFlash state={state} />
    </form>
  )
}
