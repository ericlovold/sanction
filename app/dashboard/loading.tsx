// Instant shell: paints the moment navigation starts, so the phone shows
// structure instead of a blank screen while the page's queries run.
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-8 sm:px-6">
      <div className="h-7 w-44 rounded bg-zinc-800/80" />
      <div className="mt-2 h-4 w-72 rounded bg-zinc-800/50" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    </div>
  )
}
