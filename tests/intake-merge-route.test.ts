import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: state.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc: state.rpc }) }))
import { POST } from '@/app/api/admin/matters/[id]/merge/route'
const loser = '10000000-0000-0000-0000-000000000001'
const winner = '10000000-0000-0000-0000-000000000002'
const request = () => new Request('http://localhost/api/admin/matters/'+loser+'/merge', { method: 'POST', body: JSON.stringify({ intoMatterId: winner }) })
const params = { params: Promise.resolve({ id: loser }) }
beforeEach(() => {
  vi.clearAllMocks()
  state.auth.mockResolvedValue({ err: null, userId: 'staff' })
})
it('returns the atomic questionnaire conflict to the merge dialog', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'These matters have separate saved questionnaires. Keep them separate; questionnaire reconciliation is required before merging.' } })
  const response = await POST(request(), params)
  expect(response.status).toBe(409)
  expect((await response.json()).error).toContain('separate saved questionnaires')
  expect(state.rpc).toHaveBeenCalledWith('merge_matters', { p_winner_id: winner, p_loser_id: loser, p_reason: null, p_actor_id: 'staff' })
})
it('preserves successful merge reporting', async () => {
  state.rpc.mockResolvedValue({ data: { rows_moved: { documents: 2 }, rows_left: {}, drafting_moved: false }, error: null })
  const response = await POST(request(), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, intoMatterId: winner, rowsMoved: { documents: 2 } })
})
it('authorizes before attempting a database merge', async () => {
  state.auth.mockResolvedValue({ err: new Response('Forbidden', { status: 403 }) })
  expect((await POST(request(), params)).status).toBe(403)
  expect(state.rpc).not.toHaveBeenCalled()
})
