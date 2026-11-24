import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cursorDay, cursorSources, cursorSourceUrl } from "@/lib/connectors/cursorSources"

export async function CursorSources({ walletId, day }: { walletId: string; day?: string | string[] }) {
  const today = new Date()
  const start = cursorDay(day, today)
  const result = start && await cursorSources(walletId, start)
  return (
    <Card id="cursor-sources" className="bg-card border-border">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium">Cursor usage by source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5 text-sm">
        <form action="#cursor-sources" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">Day (UTC)
            <input type="date" name="cursor_day" required max={today.toISOString().slice(0, 10)}
              defaultValue={start?.toISOString().slice(0, 10)} className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <button className="rounded border border-border px-3 py-1">Show day</button>
        </form>
        {!start && <p>Choose a valid UTC date through today.</p>}
        {result?.hasLegacy && <p>Some older records lack product and token coverage details. They are excluded until synced again.</p>}
        {result && (result.rows.length === 0 ? <p>No qualifying synced Cursor events for this day.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="pb-2 text-left text-muted-foreground">
                Reported tokens include input, output, cache writes and cache reads. Cached tokens count cache reads.
                Requests include events that omitted token usage.
              </caption>
              <thead><tr>
                {["Source", "Reported tokens", "Cached tokens", "Requests", "Requests with token data"].map((label, i) =>
                  <th key={label} scope="col" className={i ? "p-2 text-right" : "p-2"}>{label}</th>)}
              </tr></thead>
              <tbody>{result.rows.map((r) => {
                const href = cursorSourceUrl(r.kind, r.id)
                return (
                  <tr key={JSON.stringify([r.kind, r.id])} className="border-t border-border">
                    <th scope="row" className="p-2 font-normal">{r.kind}{r.id && (
                      <code className="ml-2 break-all">{href ? <a href={href} rel="noreferrer" className="underline underline-offset-2">{r.id}</a> : r.id}</code>
                    )}</th>
                    <td className="p-2 text-right tabular-nums">{r.reported ? r.tokens.toLocaleString("en-US") : "Unreported"}</td>
                    <td className="p-2 text-right tabular-nums">{r.reported ? r.cached.toLocaleString("en-US") : "Unreported"}</td>
                    <td className="p-2 text-right tabular-nums">{r.requests.toLocaleString("en-US")}</td>
                    <td className="p-2 text-right tabular-nums">{r.reported.toLocaleString("en-US")}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
