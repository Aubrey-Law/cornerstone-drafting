import { beforeEach, expect, it, vi } from 'vitest'
import { ACTIVITY_PAGE_SIZE, activityCursor, activityFilters, type ActivityRow } from '@/lib/activities/feed'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/review/staff', () => ({ requireStaffPage: mocks.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
import { fetchFirmActivities } from '@/lib/queries/firmActivities'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function query(data: ActivityRow[] = [], error: unknown = null) {
  const result = { data, error }
  const chain = { select: vi.fn(), order: vi.fn(), limit: vi.fn(), eq: vi.fn(), or: vi.fn(), contains: vi.fn(), gte: vi.fn(), lt: vi.fn(), then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) }
  for (const method of ['select', 'order', 'limit', 'eq', 'or', 'contains', 'gte', 'lt'] as const) chain[method].mockReturnValue(chain)
  mocks.from.mockReturnValue(chain)
  return chain
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: id }) })
it('preserves microsecond cursor precision and validates hostile cursors', () => {
  const row = { id: `matter:${id}`, occurred_at: '2026-10-07T12:30:00.123456+00:00' }
  expect(activityFilters({ cursor: activityCursor(row) }).cursor).toEqual({ at: row.occurred_at, id: row.id })
  for (const params of [{ cursor: 'bad' }, { actor: 'a,or(id.gt.1)' }, { from: '2026-02-30' }, { from: '2026-10-08', to: '2026-10-07' }]) expect(() => activityFilters(params)).toThrow()
})
it('authorizes before reading the service-only view', async () => {
  mocks.auth.mockRejectedValue(new Error('redirect:/auth/login'))
  await expect(fetchFirmActivities(activityFilters({}))).rejects.toThrow('redirect')
  expect(mocks.from).not.toHaveBeenCalled()
})
it('pushes filters and the two-part cursor into the database, including DST day bounds', async () => {
  const chain = query()
  const cursor = activityCursor({ id: `matter:${id}`, occurred_at: '2026-10-07T12:30:00.123456+00:00' })
  await fetchFirmActivities(activityFilters({ record: id, person: id, actor: id, source: 'matter', event: 'task_completed', from: '2026-03-08', to: '2026-03-08', cursor }))
  expect(chain.contains).toHaveBeenCalledWith('person_ids', [id])
  expect(chain.eq).toHaveBeenCalledWith('event_type', 'task_completed')
  expect(chain.gte).toHaveBeenCalledWith('occurred_at', '2026-03-08T05:00:00.000Z')
  expect(chain.lt).toHaveBeenCalledWith('occurred_at', '2026-03-09T04:00:00.000Z')
  expect(chain.or).toHaveBeenCalledWith(`occurred_at.lt.2026-10-07T12:30:00.123456+00:00,and(occurred_at.eq.2026-10-07T12:30:00.123456+00:00,id.lt.matter:${id})`)
  expect(chain.limit).toHaveBeenCalledWith(ACTIVITY_PAGE_SIZE + 1)
})
it('uses the last displayed row as cursor, never the extra lookahead row', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: `matter:${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, occurred_at: '2026-10-07T12:30:00.123456+00:00' } as ActivityRow))
  query(rows)
  const result = await fetchFirmActivities(activityFilters({}))
  expect(result.rows).toHaveLength(50)
  expect(result.next).toBe(activityCursor(rows[49]))
})
it('reports a failed read explicitly instead of presenting an empty history', async () => {
  query([], { message: 'Unavailable' })
  const result = await fetchFirmActivities(activityFilters({}))
  expect(result.error).toBeTruthy()
  expect(result.next).toBeNull()
})
it('applies both record scope and cursor without dropping either filter', async () => {
  const chain = query()
  const at = '2026-10-07T12:30:00.000001+00:00'
  await fetchFirmActivities(activityFilters({ record: id, cursor: activityCursor({ id: `lead:${id}`, occurred_at: at }) }))
  expect(chain.or.mock.calls).toHaveLength(2)
  expect(chain.or).toHaveBeenCalledWith(`matter_id.eq.${id},lead_id.eq.${id}`)
  expect(chain.order.mock.calls).toEqual([['occurred_at', { ascending: false }], ['id', { ascending: false }]])
})
