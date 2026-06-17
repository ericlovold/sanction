"use server"

import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { setSession, clearSession } from "@/lib/session"

export type LoginState = { error: string }

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
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
