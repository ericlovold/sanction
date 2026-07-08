"use client"

import { useActionState } from "react"
import { loginAction, type LoginState } from "@/app/login/actions"

const initial: LoginState = { error: "" }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initial)
  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-foreground0">Management key</span>
        <input
          name="management_key"
          type="password"
          required
          placeholder="sk_…"
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-ring"
        />
      </label>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
