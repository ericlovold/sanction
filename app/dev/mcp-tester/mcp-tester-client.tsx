"use client"

// The MCP test harness UI (docs/plans/mcp-test-ui.md). One flat screen:
// tool selector → schema-driven input form → response log with contract strip,
// plus the scenario runner with ✓/✗ verdicts and the owner-side approval button
// so the escalate → approve → grant → retry loop closes without leaving the page.

import { useCallback, useMemo, useRef, useState } from "react"
import {
  MCP_TOOLS,
  SCENARIOS,
  type FieldSpec,
  type Scenario,
  type ScenarioExpect,
  type ToolSpec,
} from "@/lib/mcpToolManifest"

const MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-2.5-pro",
  "gemini-flash",
]

type CallOutcome = {
  seq: number
  tool: string
  args: Record<string, unknown>
  isError: boolean
  text: string
  latencyMs?: number
  transport?: string
  hostError?: boolean
}

type Verdict = { scenario: Scenario; pass: boolean | null; detail: string }

function judge(expect: ScenarioExpect, outcome: CallOutcome): { pass: boolean; detail: string } {
  const text = outcome.text
  const escalated = /sanction_check_authorization/i.test(text) || /ESCALATED/.test(text)
  switch (expect) {
    case "authorized":
    case "ok":
      return { pass: !outcome.isError, detail: outcome.isError ? "expected success, got error" : "ok" }
    case "escalated":
      return { pass: outcome.isError && escalated, detail: escalated ? "escalated as expected" : "no escalation instruction in response" }
    case "denied":
      return { pass: outcome.isError && !escalated, detail: outcome.isError ? "denied as expected" : "expected denial, got success" }
    case "error-surfaced": {
      const hasCode = /[A-Z][A-Z_]{3,}/.test(text)
      return { pass: outcome.isError && hasCode, detail: hasCode ? "error code surfaced" : "no machine-readable code in response" }
    }
  }
}

function extractRequestId(text: string): string | null {
  const m = text.match(/request_id\s+([A-Za-z0-9_-]+)/) ?? text.match(/\((req[A-Za-z0-9_-]+)\)/)
  return m?.[1] ?? null
}

function extractJwt(text: string): string | null {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed?.jwt === "string" ? parsed.jwt : null
  } catch {
    return null
  }
}

function extractGrantId(text: string): string | null {
  const m = text.match(/grant_id:\s*([A-Za-z0-9_-]+)/)
  return m?.[1] ?? null
}

export function McpTesterClient() {
  const [toolName, setToolName] = useState(MCP_TOOLS[0].name)
  const [form, setForm] = useState<Record<string, string>>({})
  const [transport, setTransport] = useState<"stdio" | "http">("stdio")
  const [model, setModel] = useState(MODELS[1])
  const [log, setLog] = useState<CallOutcome[]>([])
  const [verdicts, setVerdicts] = useState<Verdict[]>([])
  const [busy, setBusy] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const seq = useRef(0)
  const lastJwt = useRef<string | null>(null)
  const lastRequestId = useRef<string | null>(null)
  // Render-safe mirror of lastRequestId (refs must not be read during render).
  const [hasEscalation, setHasEscalation] = useState(false)

  const tool: ToolSpec = useMemo(() => MCP_TOOLS.find((t) => t.name === toolName)!, [toolName])

  const call = useCallback(
    async (name: string, args: Record<string, unknown>, scenarioId?: number): Promise<CallOutcome> => {
      const res = await fetch("/api/dev/mcp-tester/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: name, args, transport, scenarioId }),
      })
      const body = await res.json().catch(() => ({ isError: true, text: "invalid response from tester API" }))
      const outcome: CallOutcome = {
        seq: ++seq.current,
        tool: name,
        args,
        isError: body.isError !== false,
        text: typeof body.text === "string" ? body.text : JSON.stringify(body),
        latencyMs: body.latencyMs,
        transport: body.transport,
        hostError: !res.ok,
      }
      const jwt = extractJwt(outcome.text)
      if (jwt) lastJwt.current = jwt
      const rid = extractRequestId(outcome.text)
      if (rid) {
        lastRequestId.current = rid
        setHasEscalation(true)
      }
      setLog((prev) => [outcome, ...prev].slice(0, 100))
      return outcome
    },
    [transport],
  )

  const materialize = useCallback((s: Scenario): Record<string, unknown> => {
    const args: Record<string, unknown> = { ...s.args }
    for (const [k, v] of Object.entries(args)) {
      if (v === "<from #11>") args[k] = lastJwt.current ?? "missing-jwt-run-scenario-11-first"
    }
    if (s.tool === "sanction_log_tokens" && typeof args.model === "string") args.model = model
    return args
  }, [model])

  const runScenario = useCallback(
    async (s: Scenario) => {
      setBusy(true)
      try {
        // Scenarios 12/13/15 depend on a live JWT from 11 — mint one if missing.
        if (JSON.stringify(s.args).includes("<from #11>") && !lastJwt.current) {
          await call("sanction_request_execution", { scope: ["STRIPE_KEY"], budget_usd: 10, ttl_seconds: 300 })
        }
        const outcome = await call(s.tool, materialize(s), s.id)
        const { pass, detail } = judge(s.expect, outcome)
        setVerdicts((prev) => [{ scenario: s, pass, detail }, ...prev.filter((v) => v.scenario.id !== s.id)])
      } finally {
        setBusy(false)
      }
    },
    [call, materialize],
  )

  const runAll = useCallback(async () => {
    setRunningAll(true)
    setVerdicts([])
    try {
      for (const s of SCENARIOS) {
        await runScenario(s)
      }
    } finally {
      setRunningAll(false)
    }
  }, [runScenario])

  const submitForm = useCallback(async () => {
    setBusy(true)
    try {
      const args: Record<string, unknown> = {}
      for (const f of tool.fields) {
        const raw = form[f.key]
        if (raw === undefined || raw === "") continue
        if (f.type === "number") args[f.key] = Number(raw)
        else if (f.type === "integer") args[f.key] = parseInt(raw, 10)
        else if (f.type === "string[]") args[f.key] = raw.split(",").map((s) => s.trim()).filter(Boolean)
        else if (f.type === "json") {
          try { args[f.key] = JSON.parse(raw) } catch { args[f.key] = raw }
        } else args[f.key] = raw
      }
      await call(tool.name, args)
    } finally {
      setBusy(false)
    }
  }, [tool, form, call])

  const ownerDecide = useCallback(async (decision: "approve" | "deny") => {
    setBusy(true)
    try {
      const res = await fetch("/api/dev/mcp-tester/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      })
      const body = await res.json().catch(() => ({}))
      setLog((prev) => [{
        seq: ++seq.current,
        tool: `owner:${decision}`,
        args: {},
        isError: !body.ok,
        text: body.decided ? `${decision} → ${body.decided}` : (body.message ?? body.error ?? "no result"),
      }, ...prev])
    } finally {
      setBusy(false)
    }
  }, [])

  const pollGrant = useCallback(async () => {
    if (!lastRequestId.current) return
    const outcome = await call("sanction_check_authorization", { request_id: lastRequestId.current })
    const grant = extractGrantId(outcome.text)
    if (grant) {
      setForm((prev) => ({ ...prev, grant_id: grant }))
    }
  }, [call])

  const passCount = verdicts.filter((v) => v.pass).length

  return (
    <div className="mx-auto max-w-6xl p-6 font-mono text-sm">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-bold">Sanction MCP Tester</h1>
          <p className="text-xs opacity-70">
            drives the real sanction-mcp server ({transport}) — dev harness, not product
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1">
            transport
            <select value={transport} onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
              className="rounded border px-1 py-0.5">
              <option value="stdio">stdio child</option>
              <option value="http">bridge :8808</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            model
            <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded border px-1 py-0.5">
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button onClick={runAll} disabled={busy || runningAll}
            className="rounded bg-black px-3 py-1 text-white disabled:opacity-40">
            {runningAll ? "running…" : "Run all scenarios"}
          </button>
          {verdicts.length > 0 && (
            <span>{passCount}/{verdicts.length} ✓</span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Tool selector + form */}
        <section className="rounded border p-4">
          <h2 className="mb-2 font-bold">Tool</h2>
          <select value={toolName} onChange={(e) => { setToolName(e.target.value); setForm({}) }}
            className="mb-2 w-full rounded border px-2 py-1">
            {MCP_TOOLS.map((t) => <option key={t.name} value={t.name}>{t.title}</option>)}
          </select>
          <p className="mb-3 text-xs opacity-70">{tool.summary}</p>
          {tool.fields.map((f: FieldSpec) => (
            <label key={f.key} className="mb-2 block text-xs">
              <span className="font-bold">{f.key}</span>
              {f.required && <span className="text-red-600"> *</span>}
              {f.type === "enum" ? (
                <select value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="mt-0.5 w-full rounded border px-2 py-1">
                  <option value="">—</option>
                  {f.enum!.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input value={form[f.key] ?? ""} placeholder={f.placeholder}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="mt-0.5 w-full rounded border px-2 py-1" />
              )}
              <span className="opacity-60">{f.help}</span>
            </label>
          ))}
          <div className="mt-3 flex gap-2">
            <button onClick={submitForm} disabled={busy}
              className="rounded bg-black px-3 py-1 text-white disabled:opacity-40">Call tool</button>
            <button onClick={pollGrant} disabled={busy || !hasEscalation}
              title="Poll the last escalated request for its grant"
              className="rounded border px-3 py-1 disabled:opacity-40">Poll grant</button>
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => ownerDecide("approve")} disabled={busy}
              className="rounded border border-green-700 px-3 py-1 text-green-700 disabled:opacity-40">
              Approve as owner
            </button>
            <button onClick={() => ownerDecide("deny")} disabled={busy}
              className="rounded border border-red-700 px-3 py-1 text-red-700 disabled:opacity-40">
              Deny as owner
            </button>
          </div>
        </section>

        {/* Scenario matrix */}
        <section className="rounded border p-4">
          <h2 className="mb-2 font-bold">Scenarios</h2>
          <ul className="space-y-1 text-xs">
            {SCENARIOS.map((s) => {
              const v = verdicts.find((x) => x.scenario.id === s.id)
              return (
                <li key={s.id} className="flex items-start gap-2">
                  <button onClick={() => runScenario(s)} disabled={busy}
                    className="rounded border px-1 disabled:opacity-40">▶</button>
                  <span className="w-5 text-center">
                    {v ? (v.pass ? "✓" : "✗") : "·"}
                  </span>
                  <span className={v ? (v.pass ? "text-green-700" : "text-red-700") : ""}>
                    {s.id}. {s.label}
                    <span className="opacity-50"> → {s.expect}</span>
                    {v && !v.pass && <span className="block opacity-70">{v.detail}</span>}
                    {s.note && <span className="block italic opacity-50">{s.note}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Response log */}
        <section className="rounded border p-4">
          <h2 className="mb-2 font-bold">Responses</h2>
          <ul className="space-y-2 text-xs">
            {log.length === 0 && <li className="opacity-50">no calls yet</li>}
            {log.map((o) => (
              <li key={o.seq} className="rounded border p-2">
                <div className="flex justify-between">
                  <span className="font-bold">{o.tool}</span>
                  <span className="opacity-60">
                    {o.isError ? "✗" : "✓"}{o.latencyMs != null ? ` ${o.latencyMs}ms` : ""}{o.transport ? ` · ${o.transport}` : ""}
                    {o.hostError ? " · HOST ERROR" : ""}
                  </span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-all">{o.text}</pre>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
