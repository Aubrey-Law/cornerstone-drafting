import { describe, expect, it, vi } from 'vitest'
import { markAgreementSent, releaseAgreementClaim } from '@/lib/engagement/repository'

/**
 * A failed send used to leave a row saying `failed` and nothing saying why.
 * The reason went to the HTTP response and the server logs; the database kept
 * only the status and the cleared lease. Diagnosing the first native sends
 * therefore depended on someone reading an error string off their screen and
 * passing it on.
 *
 * `provider_sync_error` already carried exactly this for the reconcile and
 * webhook paths, and postSend.ts already surfaced it. These pin the send path
 * doing the same, and — the part that is easy to forget — clearing it again
 * when a retry succeeds.
 */

function captureUpdate() {
  const updates: Record<string, unknown>[] = []
  const chain: Record<string, unknown> = {}
  chain.update = vi.fn((row: Record<string, unknown>) => {
    updates.push(row)
    return chain
  })
  chain.eq = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.single = vi.fn(async () => ({ data: { id: 'agreement-1' }, error: null }))
  chain.then = undefined
  const client = { from: vi.fn(() => chain) }
  return { client, updates, chain }
}

describe('recording why a send failed', () => {
  it('writes the reason and when it happened', async () => {
    const { client, updates, chain } = captureUpdate()
    // releaseAgreementClaim awaits the builder directly rather than .single().
    chain.eq = vi.fn(() => ({ ...chain, then: (resolve: (v: unknown) => void) => resolve({ error: null }) }))

    await releaseAgreementClaim(
      client as never,
      'agreement-1',
      'insert or update on table "esign_signing_sessions" violates foreign key constraint',
    )

    expect(updates).toHaveLength(1)
    expect(updates[0].status).toBe('failed')
    expect(updates[0].provider_sync_error).toContain('violates foreign key constraint')
    expect(updates[0].provider_sync_error_at).toEqual(expect.any(String))
    // The lease still has to be released, or the agreement cannot be retried.
    expect(updates[0].send_lease_id).toBeNull()
  })

  it('bounds a very long provider message', async () => {
    const { client, updates, chain } = captureUpdate()
    chain.eq = vi.fn(() => ({ ...chain, then: (resolve: (v: unknown) => void) => resolve({ error: null }) }))

    await releaseAgreementClaim(client as never, 'agreement-1', 'x'.repeat(10_000))

    expect((updates[0].provider_sync_error as string).length).toBe(2000)
  })

  it('clears the previous failure when a retry succeeds', async () => {
    // Otherwise a sent agreement keeps displaying the error from the attempt
    // before it, which reads as a live failure.
    const { client, updates } = captureUpdate()

    await markAgreementSent(client as never, 'agreement-1')

    expect(updates[0].status).toBe('sent')
    expect(updates[0].provider_sync_error).toBeNull()
    expect(updates[0].provider_sync_error_at).toBeNull()
  })
})
