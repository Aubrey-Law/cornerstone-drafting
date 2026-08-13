import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteR2Key: vi.fn(),
  requireAdmin: vi.fn(),
  deleteMatter: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/r2Delete', () => ({ deleteR2Key: mocks.deleteR2Key }))

import { MatterDeletionError, deleteMatter } from '@/lib/matters/deleteMatter'

const MATTER_ID = '33333333-3333-4333-8333-333333333333'
const INTAKE_ID = '44444444-4444-4444-8444-444444444444'
const ADMIN_ID = '55555555-5555-4555-8555-555555555555'

type Filter = [string, unknown]
type Recorded = { table: string; filters: Filter[] }

type FakeConfig = {
  /** Rows a select on the table resolves to. Absent tables resolve to []. */
  rows?: Record<string, Record<string, unknown>[]>
  /** Tables whose write fails, keyed to the error message. */
  failures?: Record<string, string>
}

function createFakeAdmin(config: FakeConfig = {}) {
  const deletes: Recorded[] = []
  const inserts: Record<string, Record<string, unknown>[]> = {}

  class Query {
    private op: 'select' | 'delete' | 'insert' = 'select'
    private row: Record<string, unknown> | null = null
    private readonly filters: Filter[] = []

    constructor(private readonly table: string) {}

    select() { this.op = 'select'; return this }
    delete() { this.op = 'delete'; return this }
    insert(row: Record<string, unknown>) { this.op = 'insert'; this.row = row; return this }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this }
    in(column: string, value: unknown) { this.filters.push([column, value]); return this }
    limit() { return this }

    private run() {
      const error = config.failures?.[this.table]
        ? { message: config.failures[this.table] }
        : null
      if (this.op === 'delete') {
        deletes.push({ table: this.table, filters: this.filters })
        return Promise.resolve({ data: null, error })
      }
      if (this.op === 'insert') {
        ;(inserts[this.table] ??= []).push(this.row ?? {})
        return Promise.resolve({ data: null, error })
      }
      return Promise.resolve({ data: config.rows?.[this.table] ?? [], error })
    }

    maybeSingle() {
      return this.run().then(result => ({
        ...result,
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      }))
    }

    then<T>(resolve: (value: { data: unknown; error: { message: string } | null }) => T) {
      return this.run().then(resolve)
    }
  }

  return {
    client: { from: (table: string) => new Query(table) } as never,
    deletes,
    inserts,
    deletedTables: () => deletes.map(entry => entry.table),
  }
}

const HIRED_MATTER = {
  id: MATTER_ID,
  client_intake_id: INTAKE_ID,
  name: 'Alvarez Family Trust',
  matter_number: '2026-014',
  stage: 'signing',
  status: 'active',
  relationship_status: 'hired',
  created_at: '2026-01-05T00:00:00.000Z',
}

const PROSPECT_MATTER = { ...HIRED_MATTER, relationship_status: 'lead', matter_number: null }

describe('deleteMatter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a prospect matter without asking for anything extra', async () => {
    const fake = createFakeAdmin({ rows: { matters: [PROSPECT_MATTER] } })

    const result = await deleteMatter(fake.client, MATTER_ID)

    expect(result).toMatchObject({ matterId: MATTER_ID, intakeId: INTAKE_ID, protections: [] })
    expect(fake.deletedTables()).toContain('matters')
    expect(fake.deletedTables()).toContain('client_intake')
  })

  it('holds a hired matter for confirmation instead of refusing it outright', async () => {
    const fake = createFakeAdmin({ rows: { matters: [HIRED_MATTER] } })

    const error = await deleteMatter(fake.client, MATTER_ID).catch(e => e)

    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('confirmation_required')
    expect(error.protections).toEqual(['hired'])
    // Nothing may be destroyed on the way to asking.
    expect(fake.deletedTables()).toEqual([])
  })

  it('names a signed engagement as its own reason to confirm', async () => {
    const fake = createFakeAdmin({
      rows: { matters: [PROSPECT_MATTER], engagement_agreements: [{ id: 'agreement-1' }] },
    })

    const error = await deleteMatter(fake.client, MATTER_ID).catch(e => e)

    expect(error.protections).toEqual(['signed_engagement'])
  })

  it('destroys a hired matter once the deletion is confirmed', async () => {
    const fake = createFakeAdmin({
      rows: {
        matters: [HIRED_MATTER],
        engagement_agreements: [{ id: 'agreement-1' }],
        matter_documents: [{ id: 'doc-1', r2_key: 'matters/doc-1.docx' }],
        document_versions: [{ r2_key: 'matters/doc-1-v1.docx', pdf_r2_key: null }],
      },
    })

    const result = await deleteMatter(fake.client, MATTER_ID, {
      confirmProtected: true,
      actorId: ADMIN_ID,
      actorEmail: 'scott@aubreylegal.com',
      reason: '  opened in error  ',
    })

    expect(result.protections).toEqual(['hired', 'signed_engagement'])
    expect(fake.deletedTables()).toContain('matters')
    expect(fake.deletedTables()).toContain('client_intake')
    expect(mocks.deleteR2Key).toHaveBeenCalledWith('matters/doc-1.docx')
    expect(mocks.deleteR2Key).toHaveBeenCalledWith('matters/doc-1-v1.docx')
  })

  it('leaves a tombstone the deleted matter cannot take with it', async () => {
    const fake = createFakeAdmin({
      rows: {
        matters: [HIRED_MATTER],
        engagement_agreements: [{ id: 'agreement-1' }],
        matter_documents: [{ id: 'doc-1', r2_key: null }],
      },
    })

    await deleteMatter(fake.client, MATTER_ID, {
      confirmProtected: true,
      actorId: ADMIN_ID,
      actorEmail: 'scott@aubreylegal.com',
      reason: '  duplicate of 2026-013  ',
    })

    expect(fake.inserts.matter_deletions?.[0]).toMatchObject({
      matter_id: MATTER_ID,
      client_intake_id: INTAKE_ID,
      matter_number: '2026-014',
      matter_name: 'Alvarez Family Trust',
      relationship_status: 'hired',
      status: 'active',
      had_signed_engagement: true,
      documents_deleted: 1,
      reason: 'duplicate of 2026-013',
      deleted_by: ADMIN_ID,
      deleted_by_email: 'scott@aubreylegal.com',
    })
  })

  it('refuses a matter that a published clause cites as preview evidence', async () => {
    const fake = createFakeAdmin({
      rows: {
        matters: [HIRED_MATTER],
        estate_clause_preview_evidence: [{ id: 'evidence-1' }],
      },
    })

    const error = await deleteMatter(fake.client, MATTER_ID, { confirmProtected: true }).catch(e => e)

    // ON DELETE RESTRICT would fire mid-delete; the check has to come first so
    // the matter is not stripped of its children on the way to the failure.
    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('blocked')
    expect(fake.deletedTables()).toEqual([])
  })

  it('reports a missing matter as not found', async () => {
    const fake = createFakeAdmin({ rows: { matters: [] } })

    const error = await deleteMatter(fake.client, MATTER_ID).catch(e => e)

    expect(error).toBeInstanceOf(MatterDeletionError)
    expect(error.code).toBe('not_found')
  })

  it('clears the text-keyed tables that no foreign key cascades from', async () => {
    const fake = createFakeAdmin({ rows: { matters: [PROSPECT_MATTER] } })

    await deleteMatter(fake.client, MATTER_ID)

    for (const table of [
      'tabular_reviews',
      'box_document_exports',
      'box_matter_folders',
      'matter_documents',
      'document_access_audit',
      'matter_activity',
      'messages',
      'matter_assistant_messages',
      'pipeline_aging_snooze',
      'sms_messages',
      'email_log',
      'work_runs',
    ]) {
      expect(fake.deletedTables()).toContain(table)
    }
  })

  it('skips the intake delete for a matter that never had one', async () => {
    const fake = createFakeAdmin({
      rows: { matters: [{ ...PROSPECT_MATTER, client_intake_id: null }] },
    })

    const result = await deleteMatter(fake.client, MATTER_ID)

    expect(result.intakeId).toBeNull()
    expect(fake.deletedTables()).not.toContain('client_intake')
  })

  it('stops before the matter row when a child table fails', async () => {
    const fake = createFakeAdmin({
      rows: { matters: [PROSPECT_MATTER] },
      failures: { messages: 'permission denied' },
    })

    await expect(deleteMatter(fake.client, MATTER_ID)).rejects.toThrow('permission denied')
    expect(fake.deletedTables()).not.toContain('matters')
    expect(mocks.deleteR2Key).not.toHaveBeenCalled()
  })
})

describe('matter delete routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({
      err: null,
      userId: ADMIN_ID,
      user: { id: ADMIN_ID, email: 'scott@aubreylegal.com' },
    })
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin' } }) }) }),
    })
    mocks.deleteMatter.mockResolvedValue({
      matterId: MATTER_ID,
      intakeId: INTAKE_ID,
      protections: [],
      documentsDeleted: 0,
    })
  })

  const loadRoutes = async () => {
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
    vi.doMock('@/lib/matters/deleteMatter', async () => {
      const actual = await vi.importActual<typeof import('@/lib/matters/deleteMatter')>(
        '@/lib/matters/deleteMatter',
      )
      return { ...actual, deleteMatter: mocks.deleteMatter }
    })
    return {
      DELETE: (await import('@/app/api/admin/matters/[id]/route')).DELETE,
      BULK: (await import('@/app/api/admin/matters/bulk-delete/route')).POST,
      // Re-imported after resetModules, so `instanceof` in the route matches
      // the error these tests throw.
      DeletionError: (await import('@/lib/matters/deleteMatter')).MatterDeletionError,
    }
  }

  const request = (body?: unknown) =>
    new Request(`http://app.test/api/admin/matters/${MATTER_ID}`, {
      method: 'DELETE',
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const params = { params: Promise.resolve({ id: MATTER_ID }) }

  it('answers an unconfirmed protected matter with the reasons, not a dead end', async () => {
    vi.resetModules()
    const { DELETE, DeletionError } = await loadRoutes()
    mocks.deleteMatter.mockRejectedValue(
      new DeletionError('Confirm it', 'confirmation_required', ['hired']),
    )

    const response = await DELETE(request(), params)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ requiresConfirmation: true, protections: ['hired'] })
  })

  it('carries the confirmation and the actor into the deletion', async () => {
    vi.resetModules()
    const { DELETE } = await loadRoutes()

    const response = await DELETE(request({ confirm: true, reason: 'opened in error' }), params)

    expect(response.status).toBe(200)
    expect(mocks.deleteMatter).toHaveBeenCalledWith(expect.anything(), MATTER_ID, {
      confirmProtected: true,
      actorId: ADMIN_ID,
      actorEmail: 'scott@aubreylegal.com',
      reason: 'opened in error',
    })
  })

  it('keeps permanent deletion to administrators', async () => {
    vi.resetModules()
    const { DELETE } = await loadRoutes()
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'attorney' } }) }) }),
    })

    const response = await DELETE(request({ confirm: true }), params)

    expect(response.status).toBe(403)
    expect(mocks.deleteMatter).not.toHaveBeenCalled()
  })

  it('flags the bulk run when protected matters were skipped', async () => {
    vi.resetModules()
    const { BULK, DeletionError } = await loadRoutes()
    mocks.deleteMatter.mockRejectedValueOnce(
      new DeletionError('Confirm it', 'confirmation_required', ['hired']),
    )

    const response = await BULK(
      new Request('http://app.test/api/admin/matters/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [MATTER_ID, INTAKE_ID] }),
      }),
    )
    const body = await response.json()

    expect(body).toMatchObject({ deleted: 1, total: 2, requiresConfirmation: true })
  })
})

describe('matter delete wiring', () => {
  it('exposes DELETE on /api/admin/matters/[id]', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/route.ts'),
      'utf8',
    )
    expect(route).toContain('export async function DELETE')
    expect(route).toContain('requireAdmin')
    expect(route).toContain('deleteMatter')
  })

  it('cleans text-keyed child tables and intake', () => {
    const lib = fs.readFileSync(path.join(process.cwd(), 'lib/matters/deleteMatter.ts'), 'utf8')
    expect(lib).toContain("from('matter_documents').delete()")
    expect(lib).toContain("from('messages').delete()")
    expect(lib).toContain("from('client_intake').delete()")
  })

  it('exposes POST bulk delete on /api/admin/matters/bulk-delete', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/bulk-delete/route.ts'),
      'utf8',
    )
    expect(route).toContain('export async function POST')
    expect(route).toContain('requireAdmin')
    expect(route).toContain('deleteMatter')
  })

  it('matters list supports stage-group filters and bulk delete', () => {
    const client = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/MattersClient.tsx'), 'utf8')
    // The matter number moved inline next to the client name; the stage
    // dropdown became a stage-group pill bar.
    expect(client).toContain('m.matter_number')
    expect(client).toContain('stageGroup')
    expect(client).toContain('GROUP_LABELS')
    expect(client).toContain('/api/admin/matters/bulk-delete')
    expect(client).toContain('Delete selected')
    // The bulk dialog has to offer the acknowledgement the route requires.
    expect(client).toContain('confirm: deleteHired')
  })

  it('logs every permanent deletion in a table the matter cannot cascade away', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260923000000_matter_deletion_log.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.matter_deletions')
    expect(migration).not.toMatch(/matter_id uuid NOT NULL REFERENCES public\.matters/)
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON public.matter_deletions FROM authenticated')
  })
})
