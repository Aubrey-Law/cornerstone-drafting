import { describe, expect, it } from 'vitest'
import { resolveMatterRef, resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import type { getAdminClient } from '@/lib/supabaseAdmin'
const id = '11111111-1111-4111-8111-111111111111'
function client(responses: Array<{ data: unknown; error?: unknown }>) {
  let calls = 0
  const admin = { from: () => {
    calls++
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => responses.shift() ?? { data: null, error: null } }
    return chain
  } } as unknown as ReturnType<typeof getAdminClient>
  return { admin, calls: () => calls }
}
describe('explicit matter references', () => {
  it('resolves a canonical hired matter with one read', async () => {
    const fixture = client([{ data: { id } }])
    expect(await resolveMatterRef({ kind: 'matter', value: id }, fixture.admin)).toEqual({ matterId: id, source: 'matter' })
    expect(fixture.calls()).toBe(1)
  })
  it.each(['number', 'intake'] as const)('resolves %s explicitly', async kind => {
    const fixture = client([{ data: { id } }])
    expect(await resolveMatterRef({ kind, value: kind === 'number' ? '2026-001' : id }, fixture.admin)).toEqual({ matterId: id, source: kind })
  })
  it('requires the design sheet to link to a hired matter', async () => {
    const fixture = client([{ data: { matter_id: id } }, { data: null }])
    expect(await resolveMatterRef({ kind: 'design-sheet', value: id }, fixture.admin)).toBeNull()
  })
  it('never treats an unresolved legacy input as a canonical identity', async () => {
    const fixture = client([])
    await expect(resolveMatterId(id, fixture.admin)).rejects.toMatchObject({ name: 'MatterReferenceNotFoundError' })
  })
  it.each(['matter', 'number', 'intake', 'design-sheet'] as const)('propagates a %s database failure', async kind => {
    const fixture = client([{ data: null, error: { message: 'unavailable' } }])
    await expect(resolveMatterRef({ kind, value: id }, fixture.admin)).rejects.toThrow('unavailable')
  })
})
