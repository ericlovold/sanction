"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { cursorBatchSize, billingProductNames, type BillingProduct } from "@/lib/cursorBilling"
import { importBillingBatch } from "./actions"

export function BillingImportForm({ walletId, walletName, product }: { walletId: string; walletName: string; product: BillingProduct }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState("")

  async function submit() {
    if (busy.current) return
    const file = input.current?.files?.[0]
    if (!file?.size) return setMessage("Choose a unified usage CSV.")
    if (file.size > 32 * 1024 * 1024) return setMessage("Choose an export smaller than 32 MiB.")
    busy.current = true
    setRunning(true)
    let processed = 0, inserted = 0
    try {
      setMessage("Reading export…")
      const { readBillingCsv } = await import("@/lib/cursorCsv")
      let parsed
      try { parsed = readBillingCsv(await file.text(), product) }
      catch { setMessage("Invalid unified usage CSV. Check the header, billing values and token units."); return }
      const { rows, skipped } = parsed
      for (let start = 0; start < rows.length; start += cursorBatchSize) {
        const batch = rows.slice(start, start + cursorBatchSize)
        inserted += await importBillingBatch(walletId, product, batch)
        processed += batch.length
        setMessage(`Processed ${processed.toLocaleString()} of ${rows.length.toLocaleString()} billing items…`)
      }
      setMessage(`Imported ${inserted.toLocaleString()} new billing items. ${(processed - inserted).toLocaleString()} already present. Skipped ${skipped.toLocaleString()} items from other products.`)
    } catch {
      setMessage(`Import interrupted after ${processed.toLocaleString()} confirmed items. Select the file again to resume.`)
    } finally {
      busy.current = false
      setRunning(false)
      router.refresh()
    }
  }

  return <div className="space-y-3 rounded-lg border p-5">
    <label htmlFor="billing-file" className="block font-medium">Import a unified usage CSV into {walletName}</label>
    <input id="billing-file" ref={input} type="file" accept=".csv,text/csv" disabled={running} className="block text-sm" />
    <p className="text-xs text-muted-foreground">The browser removes email addresses and principal IDs before upload. Only {billingProductNames[product]} rows are imported. Reimporting an export skips existing billing IDs.</p>
    <button type="button" onClick={submit} disabled={running} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Import billing items</button>
    <p role="status" className="text-sm">{message}</p>
  </div>
}
