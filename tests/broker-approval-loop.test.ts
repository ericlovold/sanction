import { afterEach, describe, expect, it, vi } from "vitest"
import { callWithApproval, type ToolCall } from "../examples/broker-approval-loop/approval-loop"

const escalation = { isError: true, content: [], _meta: { "sanction/decision": { status: "escalated", action_type: "tool.invoke", request_id: "request-test" } } }
const pending = { status: "escalated", request_id: "request-test" }
const approved = () => ({ status: "approved", request_id: "request-test", grant_id: "grant-test", grant_status: "active", grant_consumed_at: null, grant_expires_at: new Date(Date.now() + 30_000).toISOString() })
const input = () => ({ name: "demo__send", arguments: { body: "original", nested: { recipients: ["one"] } } })
const success = { content: [{ type: "text", text: "acknowledged" }] }
afterEach(() => vi.useRealTimers())

describe("bounded broker approval example", () => {
  it("polls pending then approved and retries once with deeply frozen identical arguments", async () => {
    const original = input()
    const calls: ToolCall[] = []
    const callTool = vi.fn(async (call: ToolCall) => {
      calls.push(call)
      expect(Object.isFrozen(call.arguments)).toBe(true)
      expect(Object.isFrozen(call.arguments.nested)).toBe(true)
      return calls.length === 1 ? escalation : success
    })
    const pollAuthorization = vi.fn().mockImplementationOnce(async () => {
      original.name = "changed"
      original.arguments.nested.recipients.push("two")
      return pending
    }).mockResolvedValueOnce(approved())
    expect(await callWithApproval(original, { callTool, pollAuthorization }, { pollIntervalMs: 0 })).toEqual({ status: "completed", result: success, retried: true })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(input())
    expect(calls[1]).toEqual({ ...input(), _meta: { "sanction/grant_id": "grant-test" } })
    expect(calls[1].arguments).toBe(calls[0].arguments)
    expect(pollAuthorization).toHaveBeenCalledWith("request-test", expect.any(AbortSignal))
  })

  it.each([
    { status: "denied", request_id: "request-test" },
    { ...approved(), grant_status: "consumed" },
    { ...approved(), grant_consumed_at: new Date().toISOString() },
    { ...approved(), grant_expires_at: "2000-01-01T00:00:00Z" },
    { ...approved(), grant_expires_at: null },
    { ...approved(), grant_expires_at: "garbage" },
    { ...approved(), grant_id: "" },
    { ...approved(), request_id: "other-request" },
    null,
  ])("stops without retry for terminal or invalid authorization %#", async state => {
    const callTool = vi.fn().mockResolvedValue(escalation)
    const result = await callWithApproval(input(), { callTool, pollAuthorization: vi.fn().mockResolvedValue(state) })
    expect(result.status).toBe("stopped")
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it.each([
    { content: [], _meta: [] },
    { content: [], _meta: { "sanction/decision": "escalated" } },
    { content: [], _meta: { "sanction/decision": { status: "escalated" } } },
    { content: [], _meta: { "sanction/decision": { status: "denied" } } },
  ])("does not poll malformed or terminal tool responses %#", async result => {
    const pollAuthorization = vi.fn()
    expect((await callWithApproval(input(), { callTool: vi.fn().mockResolvedValue(result), pollAuthorization })).status).toBe("stopped")
    expect(pollAuthorization).not.toHaveBeenCalled()
  })

  it.each([null, {}, { content: [null] }, { content: [], _meta: { "sanction/decision": { status: "unknown" } } }])("preserves unknown outcomes %#", async result => {
    const callTool = vi.fn().mockResolvedValue(result)
    const pollAuthorization = vi.fn()
    expect((await callWithApproval(input(), { callTool, pollAuthorization })).status).toBe("unknown")
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(pollAuthorization).not.toHaveBeenCalled()
  })

  it("returns ordinary tool errors without interpreting their text as approval instructions", async () => {
    const result = { isError: true, content: [{ type: "text", text: "escalated request-test" }] }
    const pollAuthorization = vi.fn()
    expect(await callWithApproval(input(), { callTool: vi.fn().mockResolvedValue(result), pollAuthorization })).toEqual({ status: "stopped", reason: "tool_error", result })
    expect(pollAuthorization).not.toHaveBeenCalled()
  })

  it.each([false, true])("never retries a thrown call, including retry=%s", async retry => {
    const callTool = vi.fn().mockRejectedValue(new Error("connection lost"))
    if (retry) callTool.mockResolvedValueOnce(escalation)
    const result = await callWithApproval(input(), { callTool, pollAuthorization: vi.fn().mockResolvedValue(approved()) })
    expect(result.status).toBe("unknown")
    expect(callTool).toHaveBeenCalledTimes(retry ? 2 : 1)
  })

  it.each([
    { ...escalation, _meta: { "sanction/decision": { status: "escalated", action_type: "spend", request_id: "request-test" } } },
    { ...escalation, _meta: { "sanction/decision": { status: "escalated", request_id: "request-test" } } },
    { ...escalation, isError: false },
  ])("does not poll unsupported approval origins %#", async result => {
    const pollAuthorization = vi.fn()
    expect(await callWithApproval(input(), { callTool: vi.fn().mockResolvedValue(result), pollAuthorization })).toMatchObject({ status: "stopped", reason: "unsupported_approval_origin" })
    expect(pollAuthorization).not.toHaveBeenCalled()
  })

  it("does not start a second approval loop", async () => {
    const callTool = vi.fn().mockResolvedValue(escalation)
    const pollAuthorization = vi.fn().mockResolvedValue(approved())
    expect(await callWithApproval(input(), { callTool, pollAuthorization })).toMatchObject({ status: "stopped", reason: "retry_terminal" })
    expect(callTool).toHaveBeenCalledTimes(2)
    expect(pollAuthorization).toHaveBeenCalledTimes(1)
  })

  it("bounds pending polls", async () => {
    const pollAuthorization = vi.fn().mockResolvedValue(pending)
    expect(await callWithApproval(input(), { callTool: vi.fn().mockResolvedValue(escalation), pollAuthorization }, { maxPolls: 2, pollIntervalMs: 0 })).toMatchObject({ reason: "poll_limit" })
    expect(pollAuthorization).toHaveBeenCalledTimes(2)
  })

  it.each(["call", "poll"])("bounds even an uncooperative %s callback and aborts it", async phase => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    const hang = (_arg: unknown, signal: AbortSignal) => { observedSignal = signal; return new Promise<never>(() => {}) }
    const callTool = phase === "call" ? vi.fn(hang) : vi.fn().mockResolvedValue(escalation)
    const result = callWithApproval(input(), { callTool, pollAuthorization: phase === "poll" ? hang : vi.fn() }, { timeoutMs: 25 })
    await vi.advanceTimersByTimeAsync(25)
    expect(await result).toMatchObject({ status: phase === "call" ? "unknown" : "stopped" })
    expect(observedSignal?.aborted).toBe(true)
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("stops on polling transport failure", async () => {
    const callTool = vi.fn().mockResolvedValue(escalation)
    expect(await callWithApproval(input(), { callTool, pollAuthorization: vi.fn().mockRejectedValue(new Error("503")) })).toMatchObject({ reason: "poll_failed" })
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("rejects unsafe limits and non-JSON arguments before calls", async () => {
    const callTool = vi.fn()
    const host = { callTool, pollAuthorization: vi.fn() }
    expect(await callWithApproval(input(), host, { maxPolls: 0 })).toMatchObject({ reason: "invalid_limits" })
    expect(await callWithApproval({ name: "demo", arguments: { value: NaN } }, host)).toMatchObject({ reason: "invalid_call" })
    expect(callTool).not.toHaveBeenCalled()
  })
})
