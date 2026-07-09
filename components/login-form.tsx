"use client"

import { useActionState } from "react"
import { loginAction, type LoginState } from "@/app/login/actions"

const initial: LoginState = { error: "" }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initial)
  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Management key</span>
        <input
          name="management_key"
          type="password"
          required
          placeholder="sk_…"
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none"
          style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" }}
        />
      </label>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="sn-btn sn-btn-primary sn-btn-m w-full disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
