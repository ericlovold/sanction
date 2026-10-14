"use client"

import { useActionState } from "react"
import { requestIdentityEmailLogin, confirmIdentityEmailLogin } from "./actions"

const buttonClass = "w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"

export function IdentityEmailForm({ callbackURL }: { callbackURL: string }) {
  const [state, action, pending] = useActionState(requestIdentityEmailLogin, { sent: false, error: "" })
  return <form action={action} className="space-y-4">
    <input type="hidden" name="callback_url" value={callbackURL} />
    <div>
      <label htmlFor="identity-email" className="mb-2 block text-sm font-medium">Email address</label>
      <input id="identity-email" name="email" type="email" autoComplete="email" required maxLength={200}
        className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
    </div>
    <p className="text-sm text-muted-foreground">For an existing account or a reviewer account prepared by your administrator.</p>
    {state.sent && <p role="status" className="rounded-md border border-border bg-muted px-3 py-3 text-sm">If an account exists for this address, a sign-in link is on its way. Open it and confirm to continue. The link expires in 15 minutes.</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
  </form>
}

export function ConfirmIdentityEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmIdentityEmailLogin, { error: "" })
  return <form action={action} className="space-y-5">
    <input type="hidden" name="token" value={token} />
    <p className="text-sm text-muted-foreground">Confirm to sign in on this device. If you were connecting an agent, you will return to that connection.</p>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Signing in…" : "Confirm sign-in"}</button>
  </form>
}
