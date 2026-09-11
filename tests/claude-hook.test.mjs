import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHook } from '../scripts/developer/claude-hook.mjs'
const input = { hook_event_name: 'PreToolUse', session_id: 's', cwd: '/tmp/proof', tool_name: 'Read', tool_input: { file_path: '/tmp/proof/note.txt' } }
async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'sanction-hook-'))
  try { await fn({ SANCTION_AGENT_KEY: 'pxy_fixture', SANCTION_URL: 'http://127.0.0.1:3129', SANCTION_HOOK_STATE_DIR: directory }) }
  finally { await rm(directory, { recursive: true, force: true }) }
}
const permission = r => r.hookSpecificOutput.permissionDecision
const response = obj => Response.json(obj)
describe('Claude hook', () => {
  it('blocks, polls approval, redeems the exact binding, and then needs a new decision', async () => fixture(async env => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ authorized: false, status: 'escalated', request_id: 'r' }))
      .mockResolvedValueOnce(response({ grant_id: 'g' })).mockResolvedValueOnce(response({ authorized: true, status: 'allowed' }))
      .mockResolvedValueOnce(response({ status: 'escalated', request_id: 'r2' }))
    expect(permission(await runHook(input, env, fetch))).toBe('deny')
    expect(permission(await runHook(input, env, fetch))).toBe('allow')
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ tool: 'claude-code.Read', server: 'claude-code', arguments: { cwd: input.cwd, input: input.tool_input }, grant_id: 'g' })
    expect(permission(await runHook(input, env, fetch))).toBe('deny')
    expect(fetch.mock.calls[0][1].headers['idempotency-key']).not.toBe(fetch.mock.calls[3][1].headers['idempotency-key'])
  }))
  it('keeps pending approvals blocked and does not borrow approval for changed arguments', async () => fixture(async env => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ request_id: 'r' })).mockResolvedValueOnce(response({ status: 'escalated' })).mockResolvedValueOnce(response({ request_id: 'different' }))
    expect(permission(await runHook(input, env, fetch))).toBe('deny')
    expect(permission(await runHook(input, env, fetch))).toBe('deny')
    expect(permission(await runHook({ ...input, tool_input: { file_path: '/tmp/other' } }, env, fetch))).toBe('deny')
    expect(fetch.mock.calls[2][1].method).toBe('POST')
    expect(JSON.parse(fetch.mock.calls[2][1].body).grant_id).toBeUndefined()
  }))
  it('fails closed on outage, observe, malformed input, expired grants, and concurrent attempts', async () => fixture(async env => {
    for (const result of [{ authorized: true, status: 'allowed', would_be: {} }, { authorized: true, status: 'approved' }, { authorized: false, status: 'denied', code: 'GRANT_EXPIRED' }]) {
      expect(permission(await runHook(input, env, async () => response(result)))).toBe('deny')
    }
    expect(permission(await runHook(input, env, async () => { throw Error('offline') }))).toBe('deny')
    expect(permission(await runHook({}, env))).toBe('deny')
    expect(permission(await runHook(input, { ...env, SANCTION_URL: 'http://evil.test' }))).toBe('deny')
    let release, started
    const signal = new Promise(resolve => { started = resolve })
    const first = runHook(input, env, async () => { started(); await new Promise(resolve => { release = resolve }); return response({ status: 'denied' }) })
    await signal
    expect(permission(await runHook(input, env, async () => response({ authorized: true, status: 'allowed' })))).toBe('deny')
    release(); await first
  }))
})
