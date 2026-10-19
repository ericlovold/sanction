"use client"

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">Temporarily unavailable</h1>
      <p className="text-sm text-muted-foreground">We couldn’t load this page. Please try again.</p>
      <button onClick={retry} className="rounded border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
        Try again
      </button>
    </main>
  )
}
