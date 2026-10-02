import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceDetail } from '@/lib/billing/invoices'

const mocks = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  putFileToR2: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: mocks.putFileToR2 }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/firmSettings', () => ({ loadFirmSettings: vi.fn() }))
vi.mock('@/lib/queries/invoices', () => ({ fetchInvoice: vi.fn() }))
vi.mock('@/lib/invoices/generate', () => ({
  buildInvoiceRenderData: vi.fn(async () => ({})),
  generateInvoiceArtifact: vi.fn(async () => ({
    baseName: 'Invoice 2026-0003',
    docxBytes: Buffer.from('docx'),
    pdfBytes: Buffer.from('pdf'),
    pdfUnavailableReason: null,
  })),
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mocks.inserts.push(row)
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: `doc-${mocks.inserts.length}` }, error: null }),
          }),
        }
      },
    }),
  }),
}))

import { renderAndAttachInvoice } from '@/lib/invoices/issue'

/**
 * The columns matter_documents has had since 20260806135231 dropped `folder`.
 * Writing any other key fails the insert, which is how every invoice up to
 * 2026-0003 was issued without its document.
 */
const MATTER_DOCUMENT_INSERT_COLUMNS = new Set([
  'matter_id', 'r2_key', 'name', 'size', 'content_type', 'source', 'shared_at',
])

function invoice(payer: InvoiceDetail['payer']): InvoiceDetail {
  return {
    id: 'inv-3', matterId: 'matter-1', payer, clientName: 'Neretti, Matteo', lines: [], collected: 0,
  } as unknown as InvoiceDetail
}

describe('renderAndAttachInvoice', () => {
  beforeEach(() => {
    mocks.inserts = []
    mocks.rpc.mockResolvedValue({ error: null })
  })

  it('writes only columns matter_documents still has', async () => {
    await renderAndAttachInvoice(invoice('client'), 'user-1')

    expect(mocks.inserts).toHaveLength(2)
    for (const row of mocks.inserts) {
      expect(Object.keys(row).filter(key => !MATTER_DOCUMENT_INSERT_COLUMNS.has(key))).toEqual([])
    }
    expect(mocks.rpc).toHaveBeenCalledWith('attach_invoice_documents', expect.objectContaining({
      p_pdf_document_id: 'doc-2',
      p_docx_document_id: 'doc-1',
    }))
  })

  it('shares a client invoice to the portal and files a carrier invoice unshared', async () => {
    await renderAndAttachInvoice(invoice('client'), 'user-1')
    expect(mocks.inserts.every(row => typeof row.shared_at === 'string')).toBe(true)

    mocks.inserts = []
    await renderAndAttachInvoice(invoice('metlife'), 'user-1')
    expect(mocks.inserts.every(row => row.shared_at === null)).toBe(true)
  })
})
