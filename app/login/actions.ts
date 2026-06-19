"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { setSession, clearSession } from "@/lib/session"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"

export type LoginState = { error: string }

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("login", ip, 30, 600)
  if (!rl.ok) return { error: "Too many attempts. Wait a few minutes and try again." }

  const key = String(form.get("management_key") ?? "").trim()
  if (!key) return { error: "Enter your management key." }

  const wallet = await db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(key) } })
  if (!wallet) return { error: "That key doesn't match a wallet. Use the management key (sk_…) from signup." }

  await setSession(key)
  redirect("/dashboard")
}

export async function logoutAction() {
  await clearSession()
  redirect("/login")
}
