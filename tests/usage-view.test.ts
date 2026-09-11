import { describe, it, expect, vi } from 'vitest'
const mock = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn() }))
vi.mock('../lib/db', () => ({ db: { usageObservation: mock } }))
import { usageView } from '../lib/usageView'
describe('usage view', () => {
  it('scopes both reads to wallet and labels unavailable prices and stale delivery', async () => {
    const now = new Date('2026-09-11T12:00:00Z')
    mock.groupBy.mockResolvedValue([{ source: 'codex', _max: { receivedAt: new Date(0), occurredAt: new Date(0) } }])
    mock.findMany.mockResolvedValue([
      { agentId: 'a', source: 'codex', sessionId: 's', agent: { name: 'seat' }, occurredAt: now, eventName: 'model_usage', tokensIn: 10, tokensOut: 2, estimatedCostUsd: null },
      { agentId: 'a', source: 'codex', sessionId: 's', agent: { name: 'seat' }, occurredAt: now, eventName: 'tool_activity' },
    ])
    const result = await usageView('wallet', now)
    expect(mock.findMany.mock.calls[0][0].where.agent).toEqual({ walletId: 'wallet' })
    expect(mock.groupBy.mock.calls[0][0].where.agent).toEqual({ walletId: 'wallet' })
    expect(result.connections.map(c => c.status)).toEqual(['No events received', 'No recent delivery'])
    expect(result.sessions[0]).toMatchObject({ modelCalls: 1, events: 2, unpricedCalls: 1, estimatedCost: 0 })
  })
})
