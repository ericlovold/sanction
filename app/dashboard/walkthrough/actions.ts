"use server"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requireSessionRole } from "@/lib/session"
import { startWalkthrough, advanceWalkthrough, restartWalkthrough } from "@/lib/brokerWalkthrough"
export async function walkthroughAction(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { error: "Admin access required." }
  let replacement: string | undefined
  try {
    if (form.get("operation") === "start") await startWalkthrough(wallet.id)
    else if (form.get("operation") === "advance" && typeof form.get("id") === "string") await advanceWalkthrough(wallet.id, String(form.get("id")))
    else if (form.get("operation") === "restart" && typeof form.get("id") === "string" && form.get("id")) replacement = await restartWalkthrough(wallet.id, String(form.get("id")))
    else return { error: "Invalid operation." }
    revalidatePath("/dashboard/walkthrough")
    revalidatePath("/dashboard")
  } catch {
    return { error: "Could not continue. Review the approval and the recorded count before retrying. Expired walkthroughs can be restarted; uncertain execution is not retried automatically." }
  }
  if (replacement) redirect(`/dashboard/walkthrough?run=${encodeURIComponent(replacement)}`)
  return {}
}
