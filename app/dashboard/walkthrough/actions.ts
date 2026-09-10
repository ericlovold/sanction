"use server"
import { revalidatePath } from "next/cache"
import { requireSessionRole } from "@/lib/session"
import { startWalkthrough, advanceWalkthrough } from "@/lib/brokerWalkthrough"
export async function walkthroughAction(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { error: "Admin access required." }
  try {
    if (form.get("operation") === "start") await startWalkthrough(wallet.id)
    else if (form.get("operation") === "advance" && typeof form.get("id") === "string") await advanceWalkthrough(wallet.id, String(form.get("id")))
    else return { error: "Invalid operation." }
    revalidatePath("/dashboard/walkthrough")
    revalidatePath("/dashboard")
    return {}
  } catch {
    return { error: "Could not continue. Review the approval and the recorded count before retrying. Expired walkthroughs can be restarted; uncertain execution is not retried automatically." }
  }
}
