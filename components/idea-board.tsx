"use client"

import { useActionState, useState } from "react"
import { ChevronUp } from "lucide-react"
import { submitIdeaAction, voteIdeaAction, type IdeaState } from "@/app/actions"
import type { PublicIdea } from "@/lib/ideas"

const initial: IdeaState = { ok: false, error: "" }

// Columns shown publicly, in order. `declined` is intentionally omitted.
const COLUMNS: { key: string; label: string }[] = [
  { key: "open", label: "Under consideration" },
  { key: "planned", label: "Planned" },
  { key: "in_progress", label: "In progress" },
  { key: "shipped", label: "Shipped" },
]

function VoteButton({ idea }: { idea: PublicIdea }) {
  const [votes, setVotes] = useState(idea.voteCount)
  const [voted, setVoted] = useState(false)
  const [pending, setPending] = useState(false)
  const shipped = idea.status === "shipped"

  async function vote() {
    if (voted || pending || shipped) return
    setPending(true)
    setVotes((v) => v + 1) // optimistic
    setVoted(true)
    const res = await voteIdeaAction(idea.id)
    if (res.ok && typeof res.votes === "number") setVotes(res.votes)
    else if (!res.ok) {
      setVotes((v) => v - 1) // rollback
      setVoted(false)
    }
    setPending(false)
  }

  return (
    <button
      type="button"
      onClick={vote}
      disabled={voted || pending || shipped}
      aria-label={`Upvote ${idea.title}`}
      className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-md border text-xs font-semibold transition-colors ${
        voted
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
      }`}
    >
      <ChevronUp className="h-4 w-4" />
      {votes}
    </button>
  )
}

function IdeaRow({ idea }: { idea: PublicIdea }) {
  return (
    <div className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <VoteButton idea={idea} />
      <div className="min-w-0">
        <p className="font-medium text-zinc-100">{idea.title}</p>
        {idea.detail && <p className="mt-1 text-sm text-zinc-400">{idea.detail}</p>}
        {idea.category && (
          <span className="mt-2 inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{idea.category}</span>
        )}
      </div>
    </div>
  )
}

function SubmitForm() {
  const [state, formAction, pending] = useActionState(submitIdeaAction, initial)

  if (state.ok) {
    return (
      <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
        Thanks — your idea is in. We review submissions before they appear on the board. If you left an email, we&apos;ll
        keep you posted as it moves.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input
        name="title"
        required
        maxLength={120}
        placeholder="What should we build?"
        aria-label="Idea title"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
      />
      <textarea
        name="detail"
        rows={3}
        maxLength={1000}
        placeholder="Add detail — the problem it solves, how you'd use it (optional)"
        aria-label="Idea detail"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="email"
          type="email"
          placeholder="Email for updates (optional)"
          aria-label="Email for updates"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Submit idea"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    </form>
  )
}

export function IdeaBoard({ initialIdeas }: { initialIdeas: PublicIdea[] }) {
  const byStatus = (status: string) => initialIdeas.filter((i) => i.status === status)

  return (
    <div>
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5">
        <h3 className="font-display text-lg font-semibold tracking-tight">Have an idea?</h3>
        <p className="mt-1 mb-4 text-sm text-zinc-400">
          Tell us what to build. Add your email and we&apos;ll let you know when it ships — it joins our update list too.
        </p>
        <SubmitForm />
      </div>

      <div className="mt-8 space-y-8">
        {COLUMNS.map((col) => {
          const items = byStatus(col.key)
          if (items.length === 0) return null
          return (
            <section key={col.key}>
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {col.label} <span className="text-zinc-600">· {items.length}</span>
              </h3>
              <div className="space-y-3">
                {items.map((idea) => (
                  <IdeaRow key={idea.id} idea={idea} />
                ))}
              </div>
            </section>
          )
        })}
        {initialIdeas.length === 0 && (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">
            No published ideas yet — be the first to suggest one above.
          </p>
        )}
      </div>
    </div>
  )
}
