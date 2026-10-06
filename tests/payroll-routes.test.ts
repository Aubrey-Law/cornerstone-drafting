import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdministrator: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdministrator: mocks.requireAdministrator }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))

import { GET as getRuns, POST as createRun } from '@/app/api/admin/payroll/runs/route'
import { PATCH as patchRun } from '@/app/api/admin/payroll/runs/[id]/route'
import { GET as getSettings, PUT as putSettings } from '@/app/api/admin/payroll/settings/route'
import { GET as getJournal } from '@/app/api/admin/payroll/journal/route'
import { PATCH as patchFiling } from '@/app/api/admin/payroll/filings/route'
import { PATCH as patchChecklist } from '@/app/api/admin/payroll/checklist/route'
import { mergeSettings } from '@/lib/payroll/settingsInput'
import { defaultSettings } from '@/lib/payroll/defaults'

const RUN_ID = '11111111-1111-4111-8111-111111111111'

/** A query builder whose every terminal call resolves to the given result. */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'lt', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result)
  chain.single = vi.fn(async () => result)
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

const json = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('payroll routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdministrator.mockResolvedValue({ err: null, userId: 'u', user: { id: 'u' } })
    mocks.from.mockImplementation(() => builder({ data: [], error: null }))
  })

  it('refuses anyone who is not an administrator before reading payroll', async () => {
    mocks.requireAdministrator.mockResolvedValue({
      err: Response.json({ error: 'Administrator role required' }, { status: 403 }), userId: null, user: null,
    })
    for (const response of [
      await getRuns(new Request('http://app.test/api/admin/payroll/runs')),
      await getSettings(new Request('http://app.test/api/admin/payroll/settings')),
      await getJournal(new Request('http://app.test/api/admin/payroll/journal')),
    ]) expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('answers 503 when the payroll tables are not migrated yet', async () => {
    mocks.from.mockImplementation(() => builder({ data: null, error: { code: '42P01', message: 'relation "payroll_settings" does not exist' } }))
    const response = await getRuns(new Request('http://app.test/api/admin/payroll/runs?year=2026'))
    expect(response.status).toBe(503)
  })

  it('returns the computed register for the year', async () => {
    mocks.from.mockImplementation((table: string) => builder(table === 'payroll_runs'
      ? { data: [{ id: RUN_ID, tax_year: 2026, pay_date: '2026-10-30', gross_cents: 500_000, status: 'draft', computed: {} }], error: null }
      : { data: null, error: null }))
    const response = await getRuns(new Request('http://app.test/api/admin/payroll/runs?year=2026'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.settingsStored).toBe(false)
    expect(body.register[0].paycheck.netCents).toBe(500_000 - 31_000 - 7_250 - 23_167 - 2_300)
  })

  it('validates new runs before writing', async () => {
    const bad = [
      { grossCents: 500_000 },
      { payDate: '2026-02-30', grossCents: 500_000 },
      { payDate: '2026-02-27', grossCents: 0 },
      { payDate: '2026-02-27', grossCents: 12.5 },
      { payDate: '2026-02-27', grossCents: 500_000, fedWhOverrideCents: -1 },
    ]
    for (const body of bad) {
      const response = await createRun(json('http://app.test/api/admin/payroll/runs', 'POST', body))
      expect(response.status).toBe(400)
    }
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects malformed run patches', async () => {
    const context = { params: Promise.resolve({ id: RUN_ID }) }
    expect((await patchRun(json('http://app.test/x', 'PATCH', { status: 'paid' }), context)).status).toBe(400)
    expect((await patchRun(json('http://app.test/x', 'PATCH', { fedDepositPaidOn: 'soon' }), context)).status).toBe(400)
    expect((await patchRun(json('http://app.test/x', 'PATCH', {}), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400)
  })

  it('rejects bad years, quarters, filings and checklist items', async () => {
    expect((await getRuns(new Request('http://app.test/api/admin/payroll/runs?year=26'))).status).toBe(400)
    expect((await getJournal(new Request('http://app.test/api/admin/payroll/journal?year=2026&quarter=5'))).status).toBe(400)
    expect((await patchFiling(json('http://app.test/api/admin/payroll/filings?year=2026', 'PATCH', { key: 'fed-deposit:abc' }))).status).toBe(400)
    expect((await patchChecklist(json('http://app.test/api/admin/payroll/checklist?year=2026', 'PATCH', { scope: 'weekly', itemKey: 'x', done: true }))).status).toBe(400)
    expect((await putSettings(json('http://app.test/api/admin/payroll/settings?year=2026', 'PUT', { ssRateMicros: 2_000_000 }))).status).toBe(400)
  })
})

describe('mergeSettings', () => {
  const base = defaultSettings(2026)

  it('accepts cents, rates and names and stamps the confirmation', () => {
    const merged = mergeSettings(base, { fedWhPerCheckCents: 70_000, maUiRateMicros: 18_000, employeeName: ' Scott ', ratesConfirmed: true })
    expect(merged).toMatchObject({ fedWhPerCheckCents: 70_000, maUiRateMicros: 18_000, employeeName: 'Scott' })
    expect(typeof merged === 'object' && merged.ratesConfirmedAt).toBeTruthy()
  })

  it('rejects out-of-range values and a full SSN', () => {
    expect(mergeSettings(base, { payPeriodsPerYear: 0 })).toMatch(/between 1 and 53/)
    expect(mergeSettings(base, { futaRateMicros: 1.5 })).toMatch(/whole number/)
    expect(mergeSettings(base, { employeeSsnLast4: '123456789' })).toMatch(/at most 4/)
    expect(mergeSettings(base, { employeeSsnLast4: 'abcd' })).toMatch(/last four digits/)
  })

  it('lets the PFML cap fall back to the Social Security base', () => {
    expect(mergeSettings({ ...base, pfmlWageCapCents: 100 }, { pfmlWageCapCents: null })).toMatchObject({ pfmlWageCapCents: null })
  })
})
