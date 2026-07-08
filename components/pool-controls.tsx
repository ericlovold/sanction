"use client"

import { useActionState, useMemo, useState } from "react"
import { ArrowRightLeft, Clipboard, Plus, Save, SlidersHorizontal } from "lucide-react"
import {
  applyPoolAllocationAction,
  createDelegatedPoolAction,
  moveAgentToPoolAction,
  updatePoolCapAction,
  type CreatePoolState,
  type PoolActionState,
} from "@/app/dashboard/pools/actions"

export type PoolControlPool = {
  id: string
  name: string
  parentId: string | null
  ownCapUsd: number | null
  effectiveCapUsd: number | null
  capSource: "custom" | "inherited" | "uncapped"
  childCount: number
}

export type PoolControlAgent = {
  id: string
  name: string
  walletId: string
  isActive: boolean
}

const createInitial: CreatePoolState = { ok: false, message: "" }
const updateInitial: PoolActionState = { ok: false, message: "" }
const moveInitial: PoolActionState = { ok: false, message: "" }
const allocationInitial: PoolActionState = { ok: false, message: "" }

function capText(pool: PoolControlPool | undefined) {
  if (!pool) return ""
  if (pool.ownCapUsd !== null) return String(pool.ownCapUsd)
  return ""
}

function poolSubtext(pool: PoolControlPool) {
  if (pool.capSource === "custom" && pool.ownCapUsd !== null) return `custom $${pool.ownCapUsd.toFixed(2)} / day`
  if (pool.capSource === "inherited" && pool.effectiveCapUsd !== null) return `inherits $${pool.effectiveCapUsd.toFixed(2)} / day`
  return "uncapped"
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <Clipboard className="h-3 w-3" />
      {copied ? "copied" : "copy"}
    </button>
  )
}

function Status({ state }: { state: PoolActionState | CreatePoolState }) {
  if (!state.message) return null
  return (
    <p className={`text-xs ${state.ok ? "text-signal" : "text-red-400"}`}>
      {state.message}
    </p>
  )
}

export function PoolControls({
  pools,
  agents,
}: {
  pools: PoolControlPool[]
  agents: PoolControlAgent[]
}) {
  const [createState, createAction, creating] = useActionState(createDelegatedPoolAction, createInitial)
  const [updateState, updateAction, updating] = useActionState(updatePoolCapAction, updateInitial)
  const [moveState, moveAction, moving] = useActionState(moveAgentToPoolAction, moveInitial)
  const [allocationState, allocationAction, allocating] = useActionState(applyPoolAllocationAction, allocationInitial)
  const [capWalletId, setCapWalletId] = useState(pools[0]?.id ?? "")
  const selectedCapPool = useMemo(() => pools.find((pool) => pool.id === capWalletId), [capWalletId, pools])
  const allocatablePools = useMemo(() => pools.filter((pool) => pool.childCount > 0), [pools])

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Create delegated pool</h2>
          <p className="mt-1 text-xs text-muted-foreground">Adds a child authority pool under this wallet.</p>
        </div>
        {createState.ok && createState.managementKey && (
          <div className="rounded-md border border-signal/25 bg-signal/[0.04] p-3">
            <p className="text-xs font-medium text-signal">{createState.poolName} management key</p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{createState.managementKey}</code>
              <CopyButton value={createState.managementKey} />
            </div>
          </div>
        )}
        <form action={createAction} className="space-y-2">
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Engineering AI"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
          <input
            name="owner_email"
            required
            type="email"
            placeholder="owner@company.com"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
          <input
            name="subtree_daily_cap_usd"
            inputMode="decimal"
            placeholder="Daily cap, blank for uncapped"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-signal px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? "Creating..." : "Create pool"}
          </button>
          <Status state={createState} />
        </form>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Apply allocation</h2>
          <p className="mt-1 text-xs text-muted-foreground">Splits a parent cap across direct child pools.</p>
        </div>
        <form action={allocationAction} className="space-y-2">
          <select
            name="parent_wallet_id"
            required
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="">Choose parent pool</option>
            {allocatablePools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name} - {pool.childCount} child pool{pool.childCount === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <select
            name="strategy"
            defaultValue="headroom"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="headroom">Headroom weighted</option>
            <option value="delegated">Delegated authority</option>
            <option value="spend">Current spend</option>
            <option value="equal">Equal split</option>
          </select>
          <button
            type="submit"
            disabled={allocating || allocatablePools.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-ring/50 disabled:opacity-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {allocating ? "Allocating..." : "Apply caps"}
          </button>
          <Status state={allocationState} />
        </form>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Set pool cap</h2>
          <p className="mt-1 text-xs text-muted-foreground">Writes the hard subtree cap for a pool.</p>
        </div>
        <form action={updateAction} className="space-y-2">
          <select
            name="wallet_id"
            value={capWalletId}
            onChange={(event) => setCapWalletId(event.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.name} - {poolSubtext(pool)}</option>
            ))}
          </select>
          <input
            key={selectedCapPool?.id}
            name="subtree_daily_cap_usd"
            inputMode="decimal"
            defaultValue={capText(selectedCapPool)}
            placeholder="Blank clears custom cap"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
          <button
            type="submit"
            disabled={updating}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-ring/50 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updating ? "Saving..." : "Save cap"}
          </button>
          <Status state={updateState} />
        </form>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Move agent</h2>
          <p className="mt-1 text-xs text-muted-foreground">Delegates an agent into a different authority pool.</p>
        </div>
        <form action={moveAction} className="space-y-2">
          <select
            name="agent_id"
            required
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="">Choose agent</option>
            {agents.map((agent) => {
              const pool = pools.find((p) => p.id === agent.walletId)
              return (
                <option key={agent.id} value={agent.id}>
                  {agent.name} - {pool?.name ?? "Unknown pool"}{agent.isActive ? "" : " (inactive)"}
                </option>
              )
            })}
          </select>
          <select
            name="target_wallet_id"
            required
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="">Choose target pool</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={moving || agents.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-ring/50 disabled:opacity-50"
          >
            <ArrowRightLeft className="h-4 w-4" />
            {moving ? "Moving..." : "Move agent"}
          </button>
          <Status state={moveState} />
        </form>
      </div>
    </div>
  )
}
