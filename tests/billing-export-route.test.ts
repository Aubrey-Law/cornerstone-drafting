import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => Promise.resolve({ data: mocks.tables[table] ?? [], error: null }),
    }),
  }),
}))

import { GET as exportCsv } from '@/app/api/admin/billing/export/route'

async function csvRows(): Promise<string[][]> {
  const response = await exportCsv(new Request('http://app.test/api/admin/billing/export'))
  return (await response.text()).split('\n').map(line => line.split(','))
}

describe('accounting export', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'user-1' })
    mocks.tables = {
      invoices: [
        {
          id: 'inv-client', matter_id: 'matter-1', number: '2026-0001', kind: 'invoice',
          subtotal_cents: 15_500, status: 'issued', issue_date: '2026-10-01', payer: 'client',
        },
        {
          id: 'inv-metlife', matter_id: 'matter-1', number: '2026-0002', kind: 'invoice',
          subtotal_cents: 12_000, status: 'issued', issue_date: '2026-10-01', payer: 'metlife',
        },
      ],
      billing_payments: [],
      billing_adjustments: [],
      billing_items: [
        {
          matter_id: 'matter-1', kind: 'plan_claim', label: 'CT 220 POA', amount_billed: 6_000,
          status: 'invoiced', plan: 'metlife', invoice_id: 'inv-metlife', created_at: '2026-10-01T12:00:00Z',
        },
        {
          matter_id: 'matter-1', kind: 'plan_claim', label: 'CT 230 Living Will', amount_billed: 4_500,
          status: 'to_invoice', plan: 'metlife', invoice_id: null, created_at: '2026-10-01T12:00:00Z',
        },
      ],
    }
  })

  it('labels a carrier invoice apart from client invoices', async () => {
    const rows = await csvRows()
    expect(rows.find(row => row[3] === '2026-0001')?.[0]).toBe('invoice')
    expect(rows.find(row => row[3] === '2026-0002')?.[0]).toBe('legal_plan_invoice')
  })

  it('lists a claim once: by its carrier invoice when it has one, by itself otherwise', async () => {
    const claimRows = (await csvRows()).filter(row => row[0] === 'legal_plan_claim')
    expect(claimRows.map(row => row[4])).toEqual(['CT 230 Living Will'])
  })
})
