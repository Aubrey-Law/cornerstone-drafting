import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngagementInput } from '@/lib/engagement/types'

const mocks = vi.hoisted(() => ({
  putFileToR2: vi.fn(async () => {}),
  loadR2Bytes: vi.fn(async () => Buffer.from('edited docx')),
  createDocumentVersion: vi.fn(),
  ensureInitialVersion: vi.fn(),
  loadActiveVersion: vi.fn(),
  validateEngagementPdf: vi.fn(async () => {}),
  createAgreementRevision: vi.fn(async () => ({ agreementId: 'a1', revision: { id: 'r2' } })),
  extractTrackedChangeIds: vi.fn(async (): Promise<Array<{ kind: 'ins' | 'del'; w_id: string }>> => []),
}))

vi.mock('@/lib/documentUpload', () => ({ putFileToR2: mocks.putFileToR2 }))
vi.mock('@/lib/documentApiHelpers', () => ({
  DOCX_CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  loadR2Bytes: mocks.loadR2Bytes,
}))
vi.mock('@/lib/documentVersions', () => ({
  createDocumentVersion: mocks.createDocumentVersion,
  ensureInitialVersion: mocks.ensureInitialVersion,
  loadActiveVersion: mocks.loadActiveVersion,
}))
vi.mock('@/lib/docxTrackedChanges', () => ({ extractTrackedChangeIds: mocks.extractTrackedChangeIds }))
vi.mock('@/lib/engagement/render', () => ({ validateEngagementPdf: mocks.validateEngagementPdf }))
vi.mock('@/lib/engagement/repository', () => ({ createAgreementRevision: mocks.createAgreementRevision }))

import { recordEngagementDocx, reviseEngagementFromDocument } from '@/lib/engagement/editableDocument'

const input: EngagementInput = {
  practiceArea: 'EP', clientMode: 'couple', agreementDate: '2026-10-05',
  primary: { name: 'Alex Client', email: 'alex@example.com' },
  spouse: { name: 'Sam Client', email: 'sam@example.com' },
  decedentName: null, legalPlan: null, fee: { amount: 5000, paymentTerms: 'Due on signing' },
  scopeKey: 'standard', optionalClauseKeys: [], emailMessage: '', expirationHours: 168,
}

/** A client whose tables answer from the rows given, recording writes. */
function fakeAdmin(rows: { agreement?: Record<string, unknown> }) {
  const writes: Array<{ table: string; op: string; value: unknown }> = []
  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => (table === 'engagement_agreements'
          ? { data: rows.agreement ?? null, error: null }
          : { data: { id: 'doc-new' }, error: null }),
        insert: (value: unknown) => { writes.push({ table, op: 'insert', value }); return chain },
        update: (value: unknown) => {
          writes.push({ table, op: 'update', value })
          return { eq: async () => ({ error: null }) }
        },
      }
      return chain
    },
  }
  return { admin: client as unknown as SupabaseClient, writes }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear()
})

describe('recordEngagementDocx', () => {
  it('creates the agreement\'s document on its first generate and links it', async () => {
    mocks.ensureInitialVersion.mockResolvedValueOnce({ id: 'v1' })
    const { admin, writes } = fakeAdmin({ agreement: { matter_id: 'm1', document_id: null } })

    const link = await recordEngagementDocx(admin, { agreementId: 'a1', docx: Buffer.from('docx') })

    expect(link).toEqual({ documentId: 'doc-new', documentVersionId: 'v1' })
    expect(mocks.putFileToR2).toHaveBeenCalledWith(expect.stringMatching(/^matters\/m1\/engagement\/a1\//), expect.any(Buffer), expect.any(String))
    const inserted = writes.find(w => w.table === 'matter_documents')?.value as Record<string, unknown>
    // Staff-only: the client gets the signing PDF, not the working document.
    expect(inserted).toMatchObject({ matter_id: 'm1', name: 'Engagement Agreement.docx', shared_at: null, source: 'firm' })
    expect(writes).toContainEqual({ table: 'engagement_agreements', op: 'update', value: { document_id: 'doc-new' } })
  })

  it('adds a version to the existing document on every later generate', async () => {
    mocks.createDocumentVersion.mockResolvedValueOnce({ version: { id: 'v4' } })
    const { admin, writes } = fakeAdmin({ agreement: { matter_id: 'm1', document_id: 'doc1' } })

    const link = await recordEngagementDocx(admin, { agreementId: 'a1', docx: Buffer.from('docx') })

    expect(link).toEqual({ documentId: 'doc1', documentVersionId: 'v4' })
    expect(mocks.createDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'doc1', matterId: 'm1', source: 'generated', folder: 'engagement',
    }))
    expect(writes).toEqual([])
  })
})

describe('reviseEngagementFromDocument', () => {
  const agreement = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    status: 'draft',
    document_id: 'doc1',
    active_revision: { input_snapshot: input, render_snapshot: { documentVersionId: 'v1' }, master_version: '3' },
    ...overrides,
  })
  const convertDocx = vi.fn(async () => Buffer.from('%PDF edited'))
  beforeEach(() => convertDocx.mockClear())

  it('makes the edited document the next signing revision', async () => {
    mocks.loadActiveVersion.mockResolvedValueOnce({ id: 'v2', r2_key: 'matters/m1/engagement/versions/doc1/edited.docx' })
    const { admin } = fakeAdmin({})

    const result = await reviseEngagementFromDocument(admin, agreement(), { convertDocx })

    expect(mocks.loadR2Bytes).toHaveBeenCalledWith('matters/m1/engagement/versions/doc1/edited.docx')
    // A couple's master: both signers' signature and date anchors are checked.
    expect(mocks.validateEngagementPdf).toHaveBeenCalledWith(Buffer.from('%PDF edited'), expect.arrayContaining(['[[CLIENT_2_SIGNATURE]]']))
    expect(mocks.createAgreementRevision).toHaveBeenCalledWith(admin, 'a1', expect.objectContaining({
      inputSnapshot: input,
      masterVersion: '3',
      renderSnapshot: expect.objectContaining({ documentId: 'doc1', documentVersionId: 'v2', source: 'document' }),
    }))
    expect(result.documentVersionId).toBe('v2')
  })

  it('refuses when the signing PDF already matches the document', async () => {
    mocks.loadActiveVersion.mockResolvedValueOnce({ id: 'v1', r2_key: 'k' })
    const { admin } = fakeAdmin({})
    await expect(reviseEngagementFromDocument(admin, agreement(), { convertDocx })).rejects.toThrow(/already matches/)
    expect(mocks.createAgreementRevision).not.toHaveBeenCalled()
  })

  it('refuses a document whose signature lines were removed', async () => {
    mocks.loadActiveVersion.mockResolvedValueOnce({ id: 'v2', r2_key: 'k' })
    mocks.validateEngagementPdf.mockRejectedValueOnce(new Error('Engagement PDF anchor [[CLIENT_1_SIGNATURE]] must exist exactly once; found 0'))
    const { admin } = fakeAdmin({})
    await expect(reviseEngagementFromDocument(admin, agreement(), { convertDocx }))
      .rejects.toThrow(/cannot be sent for signature: .*CLIENT_1_SIGNATURE/)
    expect(mocks.createAgreementRevision).not.toHaveBeenCalled()
  })

  it('refuses a document with unresolved tracked changes, which would print as redline', async () => {
    mocks.loadActiveVersion.mockResolvedValueOnce({ id: 'v2', r2_key: 'k' })
    mocks.extractTrackedChangeIds.mockResolvedValueOnce([{ kind: 'ins', w_id: '1' }, { kind: 'del', w_id: '2' }])
    const { admin } = fakeAdmin({})
    await expect(reviseEngagementFromDocument(admin, agreement(), { convertDocx })).rejects.toThrow(/2 unresolved tracked changes/)
    expect(convertDocx).not.toHaveBeenCalled()
  })

  it('refuses an agreement that has already been sent', async () => {
    const { admin } = fakeAdmin({})
    await expect(reviseEngagementFromDocument(admin, agreement({ status: 'sent' }), { convertDocx })).rejects.toThrow(/can no longer be revised/)
  })
})
