import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The module's default storage is R2; every test passes its own.
vi.mock('@/lib/documentApiHelpers', () => ({ loadR2Bytes: vi.fn() }))
vi.mock('@/lib/r2Delete', () => ({ deleteR2Key: vi.fn() }))
vi.mock('@/lib/documentUpload', async () => ({
  putFileToR2: vi.fn(),
  safeUploadFilename: (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_'),
}))

import {
  filePriorPlan,
  listPriorPlans,
  priorPlanDocumentName,
  priorPlanR2Key,
  type PriorPlanStorage,
} from '@/lib/documents/priorPlans'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_MATTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const UPLOAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type Row = Record<string, unknown>

/** Just enough of supabase-js for the module: select/insert/update with eq/is filters. */
function fakeAdmin(tables: Record<string, Row[]>, options: { insertError?: { code?: string; message: string } } = {}) {
  const updates: Array<{ table: string; values: Row; filters: Array<[string, string, unknown]> }> = []
  const inserts: Array<{ table: string; values: Row }> = []

  function from(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const matches = (row: Row) =>
      filters.every(([op, column, value]) => (op === 'is' ? (row[column] ?? null) === value : row[column] === value))

    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return builder },
      is: (column: string, value: unknown) => { filters.push(['is', column, value]); return builder },
      insert: (values: Row) => { mode = 'insert'; payload = values; return builder },
      update: (values: Row) => { mode = 'update'; payload = values; return builder },
      maybeSingle: async () => ({ data: (tables[table] ?? []).find(matches) ?? null, error: null }),
      single: async () => {
        if (mode === 'insert') {
          inserts.push({ table, values: payload })
          if (options.insertError) return { data: null, error: options.insertError }
          const row = { id: 'doc-new', ...payload }
          ;(tables[table] ??= []).push(row)
          return { data: row, error: null }
        }
        return { data: (tables[table] ?? []).find(matches) ?? null, error: null }
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        if (mode === 'update') {
          updates.push({ table, values: payload, filters: [...filters] })
          for (const row of tables[table] ?? []) if (matches(row)) Object.assign(row, payload)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        }
        return Promise.resolve({ data: (tables[table] ?? []).filter(matches), error: null }).then(resolve)
      },
    }
    return builder
  }

  return { client: { from } as never, updates, inserts, tables }
}

function upload(overrides: Row = {}): Row {
  return {
    id: UPLOAD,
    label: 'Smith 2019 will from prior counsel',
    filename: 'Smith Will (final).docx',
    file_kind: 'docx',
    size_bytes: 4096,
    created_at: '2026-09-20T12:00:00.000Z',
    linked_at: '2026-09-25T12:00:00.000Z',
    filed_document_id: null,
    matter_id: MATTER,
    origin: 'workbench',
    r2_key: `review-uploads/${UPLOAD}/Smith_Will_final.docx`,
    ...overrides,
  }
}

function storage(): PriorPlanStorage & { written: Array<[string, string]>; removed: string[] } {
  const written: Array<[string, string]> = []
  const removed: string[] = []
  return {
    written,
    removed,
    read: vi.fn(async () => Buffer.from('docx bytes')),
    write: vi.fn(async (key: string, _bytes: Buffer, contentType: string) => { written.push([key, contentType]) }),
    remove: vi.fn(async (key: string) => { removed.push(key) }),
  }
}

let store: ReturnType<typeof storage>
beforeEach(() => {
  store = storage()
})

describe('filePriorPlan', () => {
  it('files a copy under the matter, from the client, unshared and reviewed, and records it', async () => {
    const admin = fakeAdmin({ review_uploads: [upload()], matters: [{ id: MATTER, status: 'open' }] })

    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)

    expect(result).toMatchObject({ ok: true, alreadyFiled: false })
    const key = priorPlanR2Key(MATTER, UPLOAD, 'Smith Will (final).docx')
    expect(key).toBe(`matters/${MATTER}/client/prior-plan-${UPLOAD}-Smith_Will__final_.docx`)
    // Read from the upload's own key, written to a separate one: a copy.
    expect(store.read).toHaveBeenCalledWith(`review-uploads/${UPLOAD}/Smith_Will_final.docx`)
    expect(store.written).toEqual([[key, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']])

    const inserted = admin.inserts[0]
    expect(inserted.table).toBe('matter_documents')
    expect(inserted.values).toMatchObject({
      matter_id: MATTER,
      r2_key: key,
      name: 'Smith 2019 will from prior counsel.docx',
      size: 4096,
      source: 'client',
      shared_at: null,
      uploaded_by: 'staff-1',
      reviewed_by: 'staff-1',
    })
    expect(inserted.values.reviewed_at).toEqual(expect.any(String))

    expect(admin.updates).toEqual([
      {
        table: 'review_uploads',
        values: { filed_document_id: 'doc-new' },
        filters: [['eq', 'id', UPLOAD], ['is', 'filed_document_id', null]],
      },
    ])
    expect(admin.tables.review_uploads[0].filed_document_id).toBe('doc-new')
  })

  it('refuses an upload linked to another matter, or to none, without copying', async () => {
    for (const matterId of [OTHER_MATTER, null]) {
      const admin = fakeAdmin({ review_uploads: [upload({ matter_id: matterId })], matters: [{ id: MATTER, status: 'open' }] })
      const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
      expect(result).toMatchObject({ ok: false, status: 409, code: 'not_linked' })
    }
    expect(store.read).not.toHaveBeenCalled()
  })

  it('returns the document an upload was already filed as, without a second copy', async () => {
    const admin = fakeAdmin({
      review_uploads: [upload({ filed_document_id: 'doc-1' })],
      matter_documents: [{ id: 'doc-1', name: 'Smith 2019 will from prior counsel.docx' }],
      matters: [{ id: MATTER, status: 'open' }],
    })
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: true, alreadyFiled: true, document: { id: 'doc-1' } })
    expect(store.write).not.toHaveBeenCalled()
    expect(admin.inserts).toEqual([])
  })

  it('files again once the filed document was deleted (the link went null)', async () => {
    const admin = fakeAdmin({ review_uploads: [upload({ filed_document_id: null })], matters: [{ id: MATTER, status: 'open' }] })
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: true, alreadyFiled: false })
  })

  it('refuses a closed matter, like any upload', async () => {
    const admin = fakeAdmin({ review_uploads: [upload()], matters: [{ id: MATTER, status: 'closed' }] })
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'matter_closed' })
    expect(store.write).not.toHaveBeenCalled()
  })

  it('a racing second filing collides on the key and returns the first one’s document', async () => {
    const key = priorPlanR2Key(MATTER, UPLOAD, 'Smith Will (final).docx')
    const admin = fakeAdmin(
      {
        review_uploads: [upload()],
        matter_documents: [{ id: 'doc-first', r2_key: key }],
        matters: [{ id: MATTER, status: 'open' }],
      },
      { insertError: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    )
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: true, alreadyFiled: true, document: { id: 'doc-first' } })
    // The winner's row owns the key: its bytes are not removed.
    expect(store.removed).toEqual([])
    expect(admin.tables.review_uploads[0].filed_document_id).toBe('doc-first')
  })

  it('removes the copy when the document row cannot be written', async () => {
    const admin = fakeAdmin(
      { review_uploads: [upload()], matters: [{ id: MATTER, status: 'open' }] },
      { insertError: { message: 'permission denied' } },
    )
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: false, status: 500, code: 'insert_failed' })
    expect(store.removed).toEqual([priorPlanR2Key(MATTER, UPLOAD, 'Smith Will (final).docx')])
    expect(admin.tables.review_uploads[0].filed_document_id).toBeNull()
  })

  it('writes nothing when the upload cannot be read', async () => {
    const admin = fakeAdmin({ review_uploads: [upload()], matters: [{ id: MATTER, status: 'open' }] })
    vi.mocked(store.read).mockRejectedValueOnce(new Error('NoSuchKey'))
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: false, status: 500, code: 'copy_failed' })
    expect(admin.inserts).toEqual([])
  })

  it("refuses a snapshot the Word add-in kept: it is the firm's draft, not a prior plan", async () => {
    const admin = fakeAdmin({ review_uploads: [upload({ origin: 'word' })], matters: [{ id: MATTER, status: 'open' }] })
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'not_a_prior_plan' })
    expect(store.read).not.toHaveBeenCalled()
  })

  it('says so when the upload is gone', async () => {
    const admin = fakeAdmin({ review_uploads: [] })
    const result = await filePriorPlan(admin.client, { reviewUploadId: UPLOAD, matterId: MATTER, userId: 'staff-1' }, store)
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})

describe('listPriorPlans', () => {
  it('lists only uploads linked to the matter, filed or not', async () => {
    const admin = fakeAdmin({
      review_uploads: [
        upload(),
        upload({ id: 'filed', filed_document_id: 'doc-1', file_kind: 'pdf' }),
        upload({ id: 'elsewhere', matter_id: OTHER_MATTER }),
        upload({ id: 'word-snapshot', origin: 'word' }),
      ],
    })
    const plans = await listPriorPlans(admin.client, MATTER)
    expect(plans.map(plan => [plan.id, plan.fileKind, plan.filedDocumentId])).toEqual([
      [UPLOAD, 'docx', null],
      ['filed', 'pdf', 'doc-1'],
    ])
  })
})

describe('priorPlanDocumentName', () => {
  it('keeps the label and adds the extension once', () => {
    expect(priorPlanDocumentName('Smith 2019 will', 'pdf')).toBe('Smith 2019 will.pdf')
    expect(priorPlanDocumentName('Smith 2019 will.PDF', 'pdf')).toBe('Smith 2019 will.PDF')
  })
})

describe('migration 20261229090000_review_upload_filed_document', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261229090000_review_upload_filed_document.sql'),
    'utf8',
  )

  it('adds the filed document link, cleared when that document is deleted', () => {
    expect(sql).toMatch(
      /add column if not exists filed_document_id uuid references public\.matter_documents\(id\) on delete set null/,
    )
  })

  it('is additive only', () => {
    const statements = sql.replace(/--[^\n]*/g, '')
    expect(statements).not.toMatch(/\bdrop\b|\balter column\b|\bnot null\b/i)
  })
})
