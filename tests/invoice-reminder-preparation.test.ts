import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { prepare } = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('@/lib/billing/prepareInvoiceReminders', () => ({ prepareInvoiceReminderDrafts: prepare }))
import { GET } from '@/app/api/cron/invoice-reminders/route'
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic'); prepare.mockReset() })
afterEach(() => vi.unstubAllEnvs())
it('prepares reminders independently of the queue flag', async () => {
  prepare.mockResolvedValue({ drafted: 2, unavailable: false })
  const result = await GET(new Request('http://localhost', { headers: { authorization: 'Bearer synthetic' } }))
  expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ drafted: 2 })
})
it('rejects unauthenticated cron calls without preparing anything', async () => {
  expect((await GET(new Request('http://localhost'))).status).toBe(401)
  expect(prepare).not.toHaveBeenCalled()
})
it('reports unavailable preparation as a failed run', async () => {
  prepare.mockResolvedValue({ drafted: 0, unavailable: true })
  expect((await GET(new Request('http://localhost', { headers: { authorization: 'Bearer synthetic' } }))).status).toBe(503)
})
