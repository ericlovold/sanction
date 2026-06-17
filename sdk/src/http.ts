import { SanctionError } from "./errors"
import type { Fetch } from "./types"

export const DEFAULT_BASE_URL = "https://proxy-ai-three.vercel.app/api/v1"

export interface RequestArgs {
  baseUrl: string
  fetch: Fetch
  method: "GET" | "POST" | "PATCH"
  path: string
  headers?: Record<string, string>
  query?: Record<string, string | undefined>
  body?: unknown
}

/** Sends the request and returns status + parsed body WITHOUT throwing. */
export async function requestRaw(args: RequestArgs): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = new URL(args.baseUrl.replace(/\/$/, "") + args.path)
  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v)
  }

  const headers: Record<string, string> = { ...args.headers }
  let payload: string | undefined
  if (args.body !== undefined) {
    headers["content-type"] = "application/json"
    payload = JSON.stringify(args.body)
  }

  const res = await args.fetch(url.toString(), { method: args.method, headers, body: payload })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text ? safeJson(text) : undefined }
}

/** Single place most HTTP goes through: builds the URL, sends JSON, maps errors. */
export async function request<T>(args: RequestArgs): Promise<T> {
  const { ok, status, body } = await requestRaw(args)
  if (!ok) {
    const b = body as { error?: string; reason?: string; code?: string } | undefined
    throw new SanctionError(b?.error ?? b?.reason ?? `Request failed (${status})`, { status, code: b?.code, body })
  }
  return body as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
