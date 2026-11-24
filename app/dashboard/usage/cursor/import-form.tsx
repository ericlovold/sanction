"use client"

import { useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { cursorBatchSize } from "@/lib/cursorBilling"
import { importCursorBatch } from "./actions"

export function CursorImportForm({ walletId, walletName }: { walletId: string; walletName: string }) {
  const router = useRouter()
  const busy = useRef(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const file = new FormData(event.currentTarget).get("file")
    if (!(file instanceof File) || !file.size) return setMessage("Choose a Cursor unified usage CSV.")
    if (file.size > 32 * 1024 * 1024) return setMessage("Choose an export smaller than 32 MiB.")
    busy.current = true
    setRunning(true)
    let processed = 0, inserted = 0
    try {
      setMessage("Reading export…")
      const { readCursorCsv } = await import("@/lib/cursorCsv")
      let parsed
      try { parsed = readCursorCsv(await file.text()) }
      catch { setMessage("Invalid Cursor unified usage CSV. Check the header, billing values and token units."); return }
      const { rows, skipped } = parsed
      for (let start = 0; start < rows.length; start += cursorBatchSize) {
        const batch = rows.slice(start, start + cursorBatchSize)
        inserted += await importCursorBatch(walletId, batch)
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

  return <form onSubmit={submit} className="space-y-3 rounded-lg border p-5">
    <label htmlFor="cursor-file" className="block font-medium">Import a unified usage CSV into {walletName}</label>
    <input id="cursor-file" name="file" type="file" accept=".csv,text/csv" required disabled={running} className="block text-sm" />
    <p className="text-xs text-muted-foreground">The browser removes email addresses and principal IDs before upload. Only Cursor product rows are imported. Reimporting an export skips existing billing IDs.</p>
    <button disabled={running} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Import billing items</button>
    <p role="status" className="text-sm">{message}</p>
  </form>
}
