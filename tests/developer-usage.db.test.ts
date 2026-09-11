import { afterEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '../lib/db'
import { hashApiKey } from '../lib/apiKey'
import { upsertPolicyWithRevision } from '../lib/policy'
import { resolveApproval } from '../lib/approvals'
import { POST as ingest } from '../app/api/v1/usage/otlp/[source]/route'
import { POST as authorize } from '../app/api/v1/authorize/tool/route'
import { GET as status } from '../app/api/v1/authorize/[id]/route'
import { usageView } from '../lib/usageView'
vi.mock('next/server', async orig => ({ ...await orig<typeof import('next/server')>(), after: () => {} }))
const wallets: string[] = []
async function seed() {
  const key = `pxy_${crypto.randomUUID()}`
  const w = await db.wallet.create({ data: { name: 'usage-test', ownerEmail: `${crypto.randomUUID()}@example.test`, agents: { create: { name: 'test seat', apiKeyHash: hashApiKey(key), apiKeyPrefix: 'pxy_test' } } }, include: { agents: true } })
  wallets.push(w.id)
  return { walletId: w.id, agentId: w.agents[0].id, key }
}
afterEach(async () => {
  if (process.env.RUN_DB_TESTS !== '1') return
  for (const walletId of wallets.splice(0)) {
    await db.grant.deleteMany({ where: { walletId } })
    await db.pendingApproval.deleteMany({ where: { walletId } })
    await db.authorizationRequest.deleteMany({ where: { agent: { walletId } } })
    await db.agent.deleteMany({ where: { walletId } })
    await db.policyRevision.deleteMany({ where: { walletId } })
    await db.policy.deleteMany({ where: { walletId } })
    await db.walletKey.deleteMany({ where: { walletId } })
    await db.wallet.delete({ where: { id: walletId } })
  }
})
function req(key: string, body: unknown) { return new NextRequest('http://localhost/api', { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('developer observations and tool approvals', () => {
  it('deduplicates concurrent exports, keeps over-budget usage, and isolates wallets', async () => {
    const a = await seed(), b = await seed()
    await db.$transaction(tx => upsertPolicyWithRevision(tx, a.walletId, { dailyTokenBudgetUsd: 0 }))
    const data = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: String(BigInt(Date.now()) * BigInt(1_000_000)), attributes: Object.entries({ 'session.id': 's', 'event.name': 'api_request', input_tokens: '10', output_tokens: '2', cost_usd: '25' }).map(([key, stringValue]) => ({ key, value: { stringValue } })) }] }] }] }
    const send = (key: string) => ingest(req(key, data), { params: Promise.resolve({ source: 'claude-code' }) })
    expect((await Promise.all(Array.from({ length: 6 }, () => send(a.key)))).every(r => r.status === 200)).toBe(true)
    expect(await db.usageObservation.count({ where: { agentId: a.agentId } })).toBe(1)
    expect(await db.tokenLog.count({ where: { agentId: a.agentId } })).toBe(0)
    await db.wallet.update({ where: { id: a.walletId }, data: { frozenAt: new Date() } })
    expect((await send(a.key)).status).toBe(200)
    await db.agent.update({ where: { id: a.agentId }, data: { expiresAt: new Date(0) } })
    expect((await send(a.key)).status).toBe(401)
    await db.agent.update({ where: { id: a.agentId }, data: { expiresAt: null, isActive: false } })
    expect((await send(a.key)).status).toBe(401)
    expect((await usageView(b.walletId)).sessions).toHaveLength(0)
    await send(b.key)
    expect((await usageView(a.walletId)).sessions[0].estimatedCost).toBe(25)
    expect(await db.usageObservation.count({ where: { agentId: b.agentId } })).toBe(1)
  })
  it('blocks the native-hook request before approval, binds arguments, and consumes once', async () => {
    const a = await seed()
    await db.$transaction(tx => upsertPolicyWithRevision(tx, a.walletId, { allowedTools: ['claude-code.Read'], escalateTools: ['claude-code.Read'], enforcementMode: 'enforce', escalationTimeoutAction: 'deny' }))
    const body = { tool: 'claude-code.Read', server: 'claude-code', arguments: { cwd: '/tmp/proof', input: { file_path: '/tmp/proof/note.txt' } } }
    let executions = 0
    const run = async (payload: unknown) => { const r = await (await authorize(req(a.key, payload))).json(); if (r.authorized === true) executions++; return r }
    const first = await run(body)
    expect(first.authorized).toBe(false)
    expect(executions).toBe(0)
    const approval = await db.pendingApproval.findFirstOrThrow({ where: { walletId: a.walletId, sourceId: first.request_id } })
    expect((await resolveApproval(a.walletId, approval.id, 'approve')).ok).toBe(true)
    const poll = await (await status(new NextRequest('http://localhost', { headers: { 'x-api-key': a.key } }), { params: Promise.resolve({ id: first.request_id }) })).json()
    expect((await run({ ...body, arguments: { cwd: '/tmp/elsewhere', input: body.arguments.input }, grant_id: poll.grant_id })).authorized).toBe(false)
    const results = await Promise.all(Array.from({ length: 5 }, () => run({ ...body, grant_id: poll.grant_id })))
    expect(results.filter(r => r.authorized)).toHaveLength(1)
    expect(executions).toBe(1)
    await db.grant.updateMany({ where: { walletId: a.walletId }, data: { status: 'active', expiresAt: new Date(0) } })
    expect((await run({ ...body, grant_id: poll.grant_id })).authorized).toBe(false)
    expect(executions).toBe(1)
  })
})
