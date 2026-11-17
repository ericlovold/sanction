import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runCli, runHook } from '../claude-plugin/hooks/claude-hook.mjs'

const input = {
  hook_event_name: 'PreToolUse', session_id: 'recovery-session', cwd: '/workspace',
  tool_name: 'Read', tool_input: { file_path: '/workspace/café.txt' },
}
const selfHosted = 'https://sanction.example.test'
const permission = result => result.hookSpecificOutput.permissionDecision
const approved = () => Response.json({ authorized: true, status: 'approved', request_id: 'r', grant_id: 'g' })
const redeemed = () => Response.json({
  authorized: true, status: 'allowed', request_id: 'r', grant_id: 'g', grant_status: 'consumed',
})
let env

beforeEach(async () => {
  env = {
    SANCTION_HOOK_STATE_DIR: await mkdtemp(join(tmpdir(), 'sanction-hook-recovery-')),
    SANCTION_AGENT_KEY: 'pxy_fixture', SANCTION_URL: selfHosted,
  }
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(env.SANCTION_HOOK_STATE_DIR, { recursive: true, force: true })
})

it('declines to send a stored key when the environment changes the Sanction origin', async () => {
  const request = vi.fn()
  const result = await runHook(input, {
    ...env, SANCTION_AGENT_KEY: '', CLAUDE_PLUGIN_OPTION_SANCTION_AGENT_KEY: 'pxy_stored_fixture',
  }, request)
  expect(permission(result)).toBe('deny')
  expect(request).not.toHaveBeenCalled()
})

it('uses the explicit environment key for a self-hosted origin', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ authorized: true, status: 'allowed' }))
  const result = await runHook(input, { ...env, CLAUDE_PLUGIN_OPTION_SANCTION_AGENT_KEY: 'pxy_stored_fixture' }, request)
  expect(permission(result)).toBe('allow')
  expect(request).toHaveBeenCalledTimes(1)
  const [url, options] = request.mock.calls[0]
  expect(url.href).toBe(selfHosted + '/api/v1/authorize/tool')
  expect(options.headers['x-api-key']).toBe(env.SANCTION_AGENT_KEY)
})

it('keeps the original approval when a redemption is rate limited', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ authorized: false, status: 'escalated', request_id: 'r' }))
    .mockResolvedValueOnce(approved())
    .mockResolvedValueOnce(Response.json({ error: 'Rate limited' }, { status: 429 }))
    .mockResolvedValueOnce(approved())
    .mockResolvedValueOnce(redeemed())
  expect(permission(await runHook(input, env, request))).toBe('deny')
  expect(permission(await runHook(input, env, request))).toBe('deny')
  expect(permission(await runHook(input, env, request))).toBe('allow')

  expect(request.mock.calls.map(([url, options]) => [url.pathname, options.method])).toEqual([
    ['/api/v1/authorize/tool', 'POST'], ['/api/v1/authorize/r', 'GET'], ['/api/v1/authorize/tool', 'POST'],
    ['/api/v1/authorize/r', 'GET'], ['/api/v1/authorize/tool', 'POST'],
  ])
  for (const index of [2, 4]) {
    expect(JSON.parse(request.mock.calls[index][1].body)).toEqual({
      ...JSON.parse(request.mock.calls[0][1].body), grant_id: 'g',
    })
  }
})

it('recovers the original request when the first response was lost and its replay is already approved', async () => {
  const request = vi.fn()
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce(Response.json({
      authorized: false, status: 'denied', approval_status: 'approved', request_id: 'r',
    }))
    .mockResolvedValueOnce(approved())
    .mockResolvedValueOnce(redeemed())
  expect(permission(await runHook(input, env, request))).toBe('deny')
  expect(permission(await runHook(input, env, request))).toBe('deny')
  expect(permission(await runHook(input, env, request))).toBe('allow')

  expect(request).toHaveBeenCalledTimes(4)
  const [first, replay, poll, redemption] = request.mock.calls
  const idempotency = first[1].headers['idempotency-key']
  expect(idempotency).toBeTruthy()
  expect(replay[1].headers['idempotency-key']).toBe(idempotency)
  expect(poll[1].method).toBe('GET')
  expect(poll[0].pathname).toBe('/api/v1/authorize/r')
  expect(JSON.parse(redemption[1].body)).toEqual({ ...JSON.parse(first[1].body), grant_id: 'g' })
})

it('preserves the exact tool arguments when stdin splits a UTF-8 character', async () => {
  const encoded = Buffer.from(JSON.stringify(input))
  const split = encoded.indexOf(Buffer.from('é')) + 1
  const stdin = Readable.from([encoded.subarray(0, split), encoded.subarray(split)])
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  // The CLI receives no hook flags when manually installed.
  vi.spyOn(process.argv, 'slice').mockReturnValue([])
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  const request = vi.fn().mockResolvedValue(Response.json({ authorized: true, status: 'allowed' }))
  vi.stubGlobal('fetch', request)

  await runCli()

  expect(request).toHaveBeenCalledTimes(1)
  expect(JSON.parse(request.mock.calls[0][1].body).arguments.input).toEqual(input.tool_input)
})
