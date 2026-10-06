import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { computeRegister } from '@/lib/payroll/calc'
import { defaultSettings } from '@/lib/payroll/defaults'
import { renderPayStub } from '@/lib/payroll/payStub'

describe('pay stub', () => {
  it('renders one page for the chosen run', async () => {
    const settings = { ...defaultSettings(2026), fedWhPerCheckCents: 70_000, employerName: 'Aubrey Law LLC', employeeName: 'Owner', employeeAddress: '1 Main St\nBoston, MA', employeeSsnLast4: '1234' }
    const register = computeRegister(settings, [
      { id: 'a', payDate: '2026-09-30', grossCents: 500_000, fedWhOverrideCents: null, status: 'draft', computed: null },
      { id: 'b', payDate: '2026-10-30', grossCents: 500_000, fedWhOverrideCents: null, status: 'draft', computed: null },
    ])
    const bytes = await renderPayStub(settings, register, 'b')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getTitle()).toBe('Pay stub 2026-10-30')
    await expect(renderPayStub(settings, register, 'missing')).rejects.toThrow('not found')
  })
})
