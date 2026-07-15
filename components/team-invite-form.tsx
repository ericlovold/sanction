"use client"

import { useActionState } from "react"
import { inviteMemberAction, type InviteState } from "@/app/dashboard/team/actions"

const initial: InviteState = { ok: false, error: "" }

export function TeamInviteForm() {
  const [state, formAction, pending] = useActionState(inviteMemberAction, initial)

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="cfo@meridian.com"
          className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
        />
      </label>
      <label>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Role</span>
        <select name="role" defaultValue="admin" className="mt-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none">
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className="sn-btn sn-btn-primary sn-btn-m disabled:opacity-50">
        {pending ? "Sending…" : "Send invite"}
      </button>
      {state.ok && <p className="w-full text-sm text-emerald-400">Invite sent.</p>}
      {state.error && <p className="w-full text-sm text-red-400">{state.error}</p>}
    </form>
  )
}
