import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { runHook } from '../scripts/developer/claude-hook.mjs'

const input = {
  hook_event_name: 'PreToolUse', session_id: 'legacy-session', cwd: '/workspace',
  tool_name: 'Read', tool_input: { file_path: '/workspace/example.txt' },
}

it('blocks a tool invoked through the original settings path when the key is missing', () => {
  const script = fileURLToPath(new URL('../scripts/developer/claude-hook.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input), encoding: 'utf8', env: {},
  })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
  })
})

it('continues to request the configured tool policy through the original module export', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sanction-legacy-hook-'))
  try {
    const request = vi.fn().mockResolvedValue(Response.json({ status: 'escalated', request_id: 'r' }))
    const result = await runHook(input, {
      SANCTION_AGENT_KEY: 'pxy_fixture', SANCTION_HOOK_STATE_DIR: directory,
    }, request)
    expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      tool: 'claude-code.Read', server: 'claude-code',
      arguments: { cwd: input.cwd, input: input.tool_input },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
