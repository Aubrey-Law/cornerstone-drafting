// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import PayrollClient from '@/app/admin/payroll/PayrollClient'
import { computeRegister } from '@/lib/payroll/calc'
import { defaultSettings } from '@/lib/payroll/defaults'
import { summarizePayroll } from '@/lib/payroll/quarterly'
import type { PayrollRun } from '@/lib/payroll/types'

const settings = { ...defaultSettings(2026), fedWhPerCheckCents: 70_000, ratesConfirmedAt: '2026-01-02T00:00:00Z' }
const run: PayrollRun = {
  id: '11111111-1111-4111-8111-111111111111', taxYear: 2026, payDate: '2026-10-30', grossCents: 500_000,
  fedWhOverrideCents: null, status: 'draft', computed: null, netPaidOn: null, fedDepositPaidOn: null,
  eftpsConfirmation: null, maDepositPaidOn: null, notes: null, calendarEventId: null,
}
const register = computeRegister(settings, [run])
const year = { settings, settingsStored: true, runs: [run], register, summary: summarizePayroll(settings, register) }

describe('payroll page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = url.includes('/runs') ? year
        : url.includes('/filings') ? { filings: [] }
        : url.includes('/checklist') ? { items: [] }
        : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows the register with the computed net pay, and every tab opens', async () => {
    const user = userEvent.setup()
    render(<PayrollClient initialYear={2026} today="2026-10-06" />)
    await waitFor(() => expect(screen.getAllByText('$3,662.83').length).toBeGreaterThan(0))
    expect(screen.getByText('Register — 2026')).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/admin/payroll/runs?year=2026')

    await user.click(screen.getByRole('tab', { name: 'Quarterly & W-2' }))
    expect(await screen.findByText('W-2 year-end check — 2026')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Journal' }))
    expect(await screen.findByText('Balanced')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Deadlines' }))
    expect(await screen.findByText(/Deposit & filing deadlines/)).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Checklists' }))
    expect(await screen.findByText('Each payroll')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByLabelText(/Federal income tax withheld per paycheck/)).toBeTruthy()
  })
})
