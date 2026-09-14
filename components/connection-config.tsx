"use client"
import { useState } from "react"

export function ConnectionConfig({ text }: { text: string }) {
  const [message, setMessage] = useState("")
  return <div className="space-y-2">
    <pre className="max-w-full overflow-x-auto rounded border bg-muted/40 p-4 text-xs"><code>{text}</code></pre>
    <button type="button" className="rounded border px-3 py-2 text-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setMessage("Configuration copied. Add your seat key locally.") }
      catch { setMessage("Copy unavailable. Select and copy the configuration above.") }
    }}>Copy configuration</button>
    <p role="status" className="text-sm text-muted-foreground">{message}</p>
  </div>
}
