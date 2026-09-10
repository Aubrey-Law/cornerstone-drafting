import { describe, expect, it } from 'vitest'
import { saveDesignSheet } from '@/lib/designSheet/persistence'

/**
 * A fake that records the filters as well as the payload, because which rows
 * an update matches is the whole subject here.
 */
function fakeClient(affected: number) {
  const calls: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  return {
    calls,
    from() {
      const call = { payload: {} as Record<string, unknown>, filters: [] as Array<[string, unknown]> }
      const chain: Record<string, unknown> = {
        update: (payload: Record<string, unknown>) => {
          call.payload = payload
          calls.push(call)
          return chain
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value])
          return chain
        },
        select: () => Promise.resolve({ data: Array.from({ length: affected }, () => ({ id: 'x' })), error: null }),
      }
      return chain
    },
  }
}

describe('saveDesignSheet', () => {
  it('writes when the lock_version it was given still matches', async () => {
    const client = fakeClient(1)
    const result = await saveDesignSheet(client as never, {
      matterId: 'matter-1',
      expectedLockVersion: 3,
      fields: { concerns: 'updated' },
    })
    expect(result).toEqual({ ok: true })
    expect(client.calls[0].payload).toEqual({ concerns: 'updated', lock_version: 4 })
    expect(client.calls[0].filters).toEqual([
      ['matter_id', 'matter-1'],
      ['lock_version', 3],
    ])
  })

  it('reports a lost race rather than throwing or silently succeeding', async () => {
    // Zero rows matched: someone else saved between the read and this write.
    // Reporting success here is the bug this whole task exists to fix — it is
    // what silently destroys the other person's work.
    const client = fakeClient(0)
    const result = await saveDesignSheet(client as never, {
      matterId: 'matter-1',
      expectedLockVersion: 3,
      fields: { concerns: 'updated' },
    })
    expect(result).toEqual({ ok: false, reason: 'stale' })
  })

  it('refuses a write with nothing in it', async () => {
    const client = fakeClient(1)
    await expect(
      saveDesignSheet(client as never, { matterId: 'matter-1', expectedLockVersion: 3, fields: {} }),
    ).rejects.toThrow(/nothing to save/i)
    expect(client.calls).toEqual([])
  })

  it('never lets a caller set lock_version itself', async () => {
    // The token is the database's to move. A caller that could set it could
    // defeat the check by passing the value it wants.
    const client = fakeClient(1)
    await expect(
      saveDesignSheet(client as never, {
        matterId: 'matter-1',
        expectedLockVersion: 3,
        fields: { lock_version: 99 } as Record<string, unknown>,
      }),
    ).rejects.toThrow(/lock_version/i)
    expect(client.calls).toEqual([])
  })

  it('surfaces a database error rather than reporting a lost race', async () => {
    // A failed query and a lost race are different facts. Reporting the first
    // as the second would tell the attorney to reload when the real problem
    // is that the database refused.
    const failing = {
      from: () => {
        const chain: Record<string, unknown> = {
          update: () => chain,
          eq: () => chain,
          select: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }),
        }
        return chain
      },
    }
    await expect(
      saveDesignSheet(failing as never, {
        matterId: 'matter-1',
        expectedLockVersion: 3,
        fields: { concerns: 'x' },
      }),
    ).rejects.toThrow(/connection reset/)
  })
})
