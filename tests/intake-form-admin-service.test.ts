import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { hashIntakeFormDefinition } from '@/lib/intake/forms/hash'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'
import type { IntakeFormTemplateRow, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
import * as repository from '@/lib/intake/forms/repository'
import * as service from '@/lib/intake/forms/adminService'
import * as adminClient from '@/lib/supabaseAdmin'

vi.mock('@/lib/intake/forms/repository', () => ({
  listTemplateRows: vi.fn(), getTemplateRow: vi.fn(), getTemplateRowByKey: vi.fn(), getVersionRow: vi.fn(), getDraftRow: vi.fn(), listVersionRows: vi.fn(),
  createTemplateRow: vi.fn(), saveDraftRow: vi.fn(), createNextDraftRow: vi.fn(), publishDraftRow: vi.fn(),
  retireVersionRow: vi.fn(), archiveTemplateRow: vi.fn(), discardDraftRow: vi.fn(), listAuditEventRows: vi.fn(), duplicateTemplateRow: vi.fn(),
}))

const definition = (): IntakeFormDefinition => ({ schemaVersion: 1, key: 'test', title: 'Test', sections: [
  { id: 'personal', title: 'Personal', audience: 'client_and_staff', items: [{ kind: 'field', id: 'name', fieldId: 'client_first_name' }] },
  { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] })
const template = (overrides: Partial<IntakeFormTemplateRow> = {}): IntakeFormTemplateRow => ({
  id: 'template-1', key: 'test', name: 'Test', description: null, archived_at: null,
  created_by: 'admin-1', created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z', ...overrides,
})

// Repository tests exercise the real adapter; lifecycle service tests mock only the repository.
describe('intake form repository boundary', () => {
  async function adapter(response: { data: unknown; error: unknown }, rpcData?: unknown) {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(response),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
    }
    const client = { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: rpcData, error: null }) }
    const spy = vi.spyOn(adminClient, 'getAdminClient').mockReturnValue(client as unknown as ReturnType<typeof adminClient.getAdminClient>)
    const real = await vi.importActual<typeof repository>('@/lib/intake/forms/repository')
    return { real, client, query, spy }
  }

  it('filters a template by its unique key before the API row limit and preserves parsing', async () => {
    const college = template({ key: 'college_prep' })
    const database = [...Array.from({ length: 1_001 }, (_, i) => template({ id: `custom-${i}`, key: `a_custom_${i}` })), college]
    const { real, spy, query } = await adapter({ data: null, error: null })
    let keyFilter: string | undefined
    query.eq.mockImplementation((column, value) => { if (column === 'key') keyFilter = value; return query })
    query.maybeSingle.mockImplementation(async () => ({ data: database.filter(({ key }) => key === keyFilter)[0] ?? null, error: null }))
    try {
      await expect(real.getTemplateRowByKey('college_prep')).resolves.toEqual(college)
      await expect(real.getTemplateRowByKey('estate')).resolves.toBeNull()
      query.maybeSingle.mockResolvedValue({ data: { ...college, unknown: true }, error: null })
      await expect(real.getTemplateRowByKey('college_prep')).rejects.toThrow('Invalid intake form lifecycle response')
    } finally { spy.mockRestore() }
  })

  it('reads all version pages including a draft beyond the first API page', async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => version(definition(), {
      id: `version-${i + 1}`, version: i + 1, status: i === 1_000 ? 'draft' : 'published',
    }))
    let from = 0; let to = 999
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn((start: number, end: number) => { from = start; to = end; return query }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1_000)), error: null, count: rows.length }).then(resolve),
    }
    const spy = vi.spyOn(adminClient, 'getAdminClient').mockReturnValue({ from: () => query } as unknown as ReturnType<typeof adminClient.getAdminClient>)
    const real = await vi.importActual<typeof repository>('@/lib/intake/forms/repository')
    try {
      const result = await real.listVersionRows('template-1')
      expect(result).toHaveLength(1_001)
      expect(result.at(-1)).toMatchObject({ id: 'version-1001', version: 1_001, status: 'draft' })
    } finally { spy.mockRestore() }
  })

  it('parses stored versions and rejects malformed definitions without fallback', async () => {
    const { real, spy } = await adapter({ data: { ...version(), definition: { schemaVersion: 1 } }, error: null })
    try {
      await expect(real.getVersionRow('version-1')).rejects.toThrow('Stored intake form version version-1 is invalid')
      await expect(real.getDraftRow('template-1')).rejects.toThrow('Stored intake form version version-1 is invalid')
    } finally { spy.mockRestore() }
  })

  it('rejects invalid definitions in version lists', async () => {
    const { real, spy } = await adapter({ data: [{ ...version(), definition: null }], error: null })
    try { await expect(real.listVersionRows('template-1')).rejects.toThrow('Stored intake form version version-1 is invalid') }
    finally { spy.mockRestore() }
  })

  it('preserves read errors and distinguishes missing versions', async () => {
    const failure = { code: 'XX000', message: 'Database failed' }
    const { real, spy, query } = await adapter({ data: null, error: failure })
    try {
      await expect(real.getVersionRow('missing')).rejects.toBe(failure)
      query.maybeSingle.mockResolvedValue({ data: null, error: null })
      await expect(real.getVersionRow('missing')).resolves.toBeNull()
    } finally { spy.mockRestore() }
  })

  it('uses the actor and CAS arguments in save RPC without rereading a newer draft', async () => {
    const row = version(definition(), { lock_version: 4 })
    const { definition: _definition, ...metadata } = row
    const { real, spy, client } = await adapter({ data: null, error: null }, metadata)
    try {
      await expect(real.saveDraftRow({ versionId: 'version-1', expectedLockVersion: 3, actorId: 'admin-1',
        definition: definition(), definitionHash: row.definition_hash })).resolves.toEqual(row)
      expect(client.rpc).toHaveBeenCalledWith('save_intake_form_draft', {
        p_actor_id: 'admin-1', p_version_id: 'version-1', p_expected_lock_version: 3,
        p_definition: definition(), p_definition_hash: row.definition_hash,
      })
      expect(client.from).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it('rejects malformed RPC metadata and mismatched returned definition hashes', async () => {
    const { real, spy, client } = await adapter({ data: null, error: null }, { id: 'version-1' })
    const input = { versionId: 'version-1', expectedLockVersion: 3, actorId: 'admin-1', definition: definition(), definitionHash: version().definition_hash }
    try {
      await expect(real.saveDraftRow(input)).rejects.toThrow('Invalid intake form lifecycle response')
      const { definition: _definition, ...metadata } = version()
      client.rpc.mockResolvedValue({ data: { ...metadata, definition_hash: '0'.repeat(64) }, error: null })
      await expect(real.saveDraftRow(input)).rejects.toThrow('Stored intake form version version-1 is invalid')
    } finally { spy.mockRestore() }
  })

  it('uses the publish RPC with both guards and parses its persisted source', async () => {
    const row = version()
    const { definition: _definition, ...metadata } = row
    const { real, spy, client } = await adapter({ data: row, error: null }, { ...metadata, status: 'published', published_by: 'admin-1', published_at: row.created_at })
    try {
      await expect(real.publishDraftRow({ versionId: row.id, expectedLockVersion: 3, expectedDefinitionHash: row.definition_hash, actorId: 'admin-1' }))
        .resolves.toMatchObject({ status: 'published', definition: row.definition })
      expect(client.rpc).toHaveBeenCalledWith('publish_intake_form_draft', { p_actor_id: 'admin-1', p_version_id: row.id,
        p_expected_lock_version: 3, p_expected_definition_hash: row.definition_hash })
    } finally { spy.mockRestore() }
  })

  it('creates a template and its independent draft through one RPC', async () => {
    const row = version(definition(), { lock_version: 0 })
    const { definition: _definition, ...metadata } = row
    const { real, spy, client } = await adapter({ data: template(), error: null }, metadata)
    try {
      await expect(real.createTemplateRow({ key: 'test', name: 'Test', actorId: 'admin-1',
        definition: definition(), definitionHash: row.definition_hash })).resolves.toEqual({ template: template(), draft: row })
      expect(client.rpc).toHaveBeenCalledWith('create_intake_form_template', { p_actor_id: 'admin-1', p_key: 'test',
        p_name: 'Test', p_description: null, p_definition: definition(), p_definition_hash: row.definition_hash })
    } finally { spy.mockRestore() }
  })

  it('copies the parsed published definition through the next-draft RPC', async () => {
    const source = version(definition(), { status: 'published' })
    const next = version(definition(), { id: 'version-next', version: 2, lock_version: 0 })
    const { definition: _definition, ...metadata } = next
    const { real, spy, client } = await adapter({ data: source, error: null }, metadata)
    try {
      await expect(real.createNextDraftRow({ sourceVersionId: source.id, actorId: 'admin-1' })).resolves.toEqual(next)
      expect(client.rpc).toHaveBeenCalledWith('create_next_intake_form_draft', { p_actor_id: 'admin-1', p_source_version_id: source.id })
    } finally { spy.mockRestore() }
  })

  it('retires a parsed immutable source through the status RPC', async () => {
    const source = version(definition(), { status: 'published' })
    const { definition: _definition, ...metadata } = source
    const { real, spy, client } = await adapter({ data: source, error: null }, { ...metadata, status: 'retired' })
    try {
      await expect(real.retireVersionRow({ versionId: source.id, actorId: 'admin-1' })).resolves.toMatchObject({ id: source.id, status: 'retired' })
      expect(client.rpc).toHaveBeenCalledWith('retire_intake_form_version', { p_actor_id: 'admin-1', p_version_id: source.id })
    } finally { spy.mockRestore() }
  })

  it('archives with an explicit flag through the archive RPC', async () => {
    const { real, spy, client } = await adapter({ data: null, error: null }, template())
    try {
      await expect(real.archiveTemplateRow({ templateId: 'template-1', archived: false, actorId: 'admin-1' })).resolves.toEqual(template())
      expect(client.rpc).toHaveBeenCalledWith('archive_intake_form_template', { p_actor_id: 'admin-1', p_template_id: 'template-1', p_archived: false })
    } finally { spy.mockRestore() }
  })

  it('uses only the guarded discard RPC for explicit draft removal', async () => {
    const row = version()
    const { definition: _definition, ...metadata } = row
    const { real, spy, client } = await adapter({ data: row, error: null }, metadata)
    try {
      await expect(real.discardDraftRow({ versionId: row.id, expectedLockVersion: 3, actorId: 'admin-1' })).resolves.toEqual(row)
      expect(client.rpc).toHaveBeenCalledWith('discard_intake_form_draft', { p_actor_id: 'admin-1', p_version_id: row.id, p_expected_lock_version: 3 })
    } finally { spy.mockRestore() }
  })

  it('does not attempt a lifecycle mutation when its stored source is invalid', async () => {
    const { real, spy, client } = await adapter({ data: { ...version(), definition: {} }, error: null })
    try {
      await expect(real.createNextDraftRow({ sourceVersionId: 'version-1', actorId: 'admin-1' }))
        .rejects.toThrow('Stored intake form version version-1 is invalid')
      expect(client.rpc).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it('reports a disappeared draft as a concurrency conflict for publish and discard', async () => {
    const { real, spy, client } = await adapter({ data: null, error: null })
    try {
      await expect(real.publishDraftRow({ versionId: 'missing', actorId: 'admin-1', expectedLockVersion: 3,
        expectedDefinitionHash: version().definition_hash })).rejects.toMatchObject({ code: '40001', message: 'Draft changed; refresh and try again' })
      await expect(real.discardDraftRow({ versionId: 'missing', actorId: 'admin-1', expectedLockVersion: 3 }))
        .rejects.toMatchObject({ code: '40001', message: 'Draft changed; refresh and try again' })
      expect(client.rpc).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it('limits audit reads to 50 and orders ties deterministically without exposing raw metadata', async () => {
    const row = auditEvent()
    const { real, spy, client, query } = await adapter({ data: [row], error: null })
    try {
      await expect(real.listAuditEventRows(row.template_id, 100)).resolves.toEqual([row])
      expect(client.from).toHaveBeenCalledWith('intake_form_audit_events')
      expect(query.eq).toHaveBeenCalledWith('template_id', row.template_id)
      expect(query.limit).toHaveBeenCalledWith(50)
      expect(query.order.mock.calls).toEqual([['occurred_at', { ascending: false }], ['id', { ascending: false }]])
      await real.listAuditEventRows(row.template_id, 2)
      expect(query.limit).toHaveBeenLastCalledWith(2)
    } finally { spy.mockRestore() }
  })

  it.each([[], null, new Date(), { nested: undefined }, { nested: Number.NaN }, { nested: new Date() }].map((metadata) => ({ metadata })))('fails closed for non-JSON-object audit metadata: $metadata', async ({ metadata }) => {
    const { real, spy } = await adapter({ data: [{ ...auditEvent(), metadata }], error: null })
    try { await expect(real.listAuditEventRows(auditEvent().template_id)).rejects.toThrow('Stored intake form audit event is invalid') }
    finally { spy.mockRestore() }
  })

  it('rejects unknown audit fields and actions, and preserves storage failures', async () => {
    for (const raw of [{ ...auditEvent(), extra: true }, { ...auditEvent(), action: 'delete' }]) {
      const { real, spy } = await adapter({ data: [raw], error: null })
      try { await expect(real.listAuditEventRows(auditEvent().template_id)).rejects.toThrow('Stored intake form audit event is invalid') }
      finally { spy.mockRestore() }
    }
    const failure = { code: 'XX000', message: 'audit unavailable' }
    const { real, spy } = await adapter({ data: null, error: failure })
    try { await expect(real.listAuditEventRows(auditEvent().template_id)).rejects.toBe(failure) }
    finally { spy.mockRestore() }
  })

  it('atomically duplicates the parsed source with rewritten identity and source guards', async () => {
    const source = version(definition(), { status: 'published', version: 5 })
    const copied = { ...definition(), key: 'copy' }
    const draft = version(copied, { id: 'copy-version', template_id: 'copy-template', lock_version: 0 })
    const { definition: _definition, ...metadata } = draft
    const { real, spy, client, query } = await adapter({ data: source, error: null }, metadata)
    query.maybeSingle.mockResolvedValueOnce({ data: source, error: null })
      .mockResolvedValueOnce({ data: template({ id: 'copy-template', key: 'copy', name: 'Copy' }), error: null })
    try {
      const result = await real.duplicateTemplateRow({ sourceVersionId: source.id, actorId: 'admin-1', key: 'copy', name: 'Copy' })
      expect(result).toMatchObject({ template: { id: 'copy-template', key: 'copy' }, draft: { definition: copied, lock_version: 0 } })
      expect(client.rpc.mock.calls).toEqual([['duplicate_intake_form_template', {
        p_actor_id: 'admin-1', p_source_version_id: source.id, p_key: 'copy', p_name: 'Copy', p_description: null,
        p_expected_lock_version: 3, p_expected_definition_hash: source.definition_hash,
        p_definition: copied, p_definition_hash: hashIntakeFormDefinition(copied),
      }]])
      result.draft.definition.sections[0].title = 'Changed copy'
      expect(source.definition.sections[0].title).toBe('Personal')
    } finally { spy.mockRestore() }
  })

  it('refuses invalid duplication sources and mismatched RPC hashes', async () => {
    const { real, spy, client, query } = await adapter({ data: { ...version(), definition: {} }, error: null })
    const input = { sourceVersionId: 'version-1', actorId: 'admin-1', key: 'copy', name: 'Copy' }
    try {
      await expect(real.duplicateTemplateRow(input)).rejects.toThrow('Stored intake form version version-1 is invalid')
      expect(client.rpc).not.toHaveBeenCalled()
      query.maybeSingle.mockResolvedValue({ data: version(), error: null })
      const { definition: _definition, ...metadata } = version()
      client.rpc.mockResolvedValue({ data: metadata, error: null })
      await expect(real.duplicateTemplateRow(input)).rejects.toThrow('Stored intake form version version-1 is invalid')
    } finally { spy.mockRestore() }
  })

  it('turns a source discarded after the read into the existing source conflict', async () => {
    const { real, spy, client } = await adapter({ data: version(), error: null })
    client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Source version required' } })
    try {
      await expect(real.duplicateTemplateRow({ sourceVersionId: 'version-1', actorId: 'admin-1', key: 'copy', name: 'Copy' }))
        .rejects.toMatchObject({ code: '40001', message: 'Source changed; refresh and try again' })
    } finally { spy.mockRestore() }
  })

  it.each([
    { code: 'P0001', message: 'Other database validation failed' },
    { code: 'XX000', message: 'Source version required' },
    { code: 'P0001', message: 'Source version required with unexpected detail' },
  ])('preserves unrelated duplicate RPC errors: $code / $message', async (failure) => {
    const { real, spy, client } = await adapter({ data: version(), error: null })
    client.rpc.mockResolvedValue({ data: null, error: failure })
    try {
      await expect(real.duplicateTemplateRow({ sourceVersionId: 'version-1', actorId: 'admin-1', key: 'copy', name: 'Copy' }))
        .rejects.toBe(failure)
    } finally { spy.mockRestore() }
  })

  it('maps the raced duplicate RPC rejection through the real repository to a typed service conflict', async () => {
    const { real, spy, client } = await adapter({ data: version(), error: null })
    client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Source version required' } })
    vi.mocked(repository.duplicateTemplateRow).mockImplementation(real.duplicateTemplateRow)
    try {
      await expect(service.duplicateIntakeFormTemplateFromTemplate({ templateId: 'template-1', sourceVersionId: 'version-1',
        actorId: 'admin-1', key: 'copy', name: 'Copy' }))
        .rejects.toMatchObject({ code: 'INTAKE_FORM_CONFLICT', message: 'Source changed; refresh and try again' })
    } finally { spy.mockRestore() }
  })
})
const auditEvent = () => ({
  id: '11111111-1111-4111-8111-111111111111', template_id: '22222222-2222-4222-8222-222222222222',
  version_id: null, version_number: 1, action: 'discard', actor_id: '33333333-3333-4333-8333-333333333333',
  metadata: { source_version_id: 'old-version', nested: [true, null, 1] }, occurred_at: '2026-10-08T12:00:00Z',
})
const version = (raw = definition(), overrides: Partial<IntakeFormVersionRow> = {}): IntakeFormVersionRow => ({
  id: 'version-1', template_id: 'template-1', version: 1, status: 'draft', definition: raw,
  definition_hash: hashIntakeFormDefinition(raw), lock_version: 3, created_by: 'admin-1',
  published_by: overrides.status && overrides.status !== 'draft' ? 'admin-1' : null,
  created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z',
  published_at: overrides.status && overrides.status !== 'draft' ? '2026-10-08T12:00:00Z' : null, ...overrides,
})
const save = (raw: unknown) => service.saveIntakeFormDraft({ versionId: 'version-1', expectedLockVersion: 3, actorId: 'admin-1', definition: raw })
const publish = (overrides = {}) => service.publishIntakeFormDraft({ versionId: 'version-1', expectedLockVersion: 3,
  expectedDefinitionHash: hashIntakeFormDefinition(definition()), actorId: 'admin-1', ...overrides })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(repository.getVersionRow).mockResolvedValue(version())
  vi.mocked(repository.getTemplateRow).mockResolvedValue(template())
  vi.mocked(repository.saveDraftRow).mockImplementation(async (input) => version(input.definition, { lock_version: 4 }))
})

describe('intake form lifecycle service', () => {
  it('rejects definition-key drift before saving a draft', async () => {
    const raw = definition(); raw.key = 'other_form'
    await expect(save(raw)).rejects.toMatchObject({
      code: 'INTAKE_FORM_VALIDATION', message: 'Definition key must match the template key',
    })
    expect(repository.getTemplateRow).toHaveBeenCalledWith('template-1')
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
  })

  it('rejects a pre-existing hash-valid identity mismatch before publication', async () => {
    const raw = definition(); raw.key = 'other_form'
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(raw))
    await expect(publish({ expectedDefinitionHash: hashIntakeFormDefinition(raw) })).rejects.toMatchObject({
      code: 'INTAKE_FORM_VALIDATION', message: 'Definition key must match the template key',
    })
    expect(repository.getTemplateRow).toHaveBeenCalledWith('template-1')
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('rejects save and publish when the owning template is missing', async () => {
    vi.mocked(repository.getTemplateRow).mockResolvedValue(null)
    await expect(save(definition())).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    await expect(publish()).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it.each([null, version(definition(), { status: 'published' }), version(definition(), { lock_version: 4 })])(
    'preserves save conflicts for a missing, immutable, or stale draft before identity validation', async (row) => {
      vi.mocked(repository.getVersionRow).mockResolvedValue(row)
      const raw = definition(); raw.key = 'other_form'
      await expect(save(raw)).rejects.toBeInstanceOf(service.IntakeFormConflictError)
      expect(repository.saveDraftRow).not.toHaveBeenCalled()
      expect(repository.getTemplateRow).not.toHaveBeenCalled()
    },
  )

  it('saves and discards the current draft identified by its template', async () => {
    vi.mocked(repository.getDraftRow).mockResolvedValue(version())
    vi.mocked(repository.discardDraftRow).mockResolvedValue(version())
    await expect(service.saveIntakeFormTemplateDraft({ templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 3,
      definition: definition() })).resolves.toMatchObject({ draft: { lock_version: 4 } })
    await service.discardIntakeFormTemplateDraft({ templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 3 })
    expect(repository.saveDraftRow).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version-1' }))
    expect(repository.discardDraftRow).toHaveBeenCalledWith({ versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 3 })
  })

  it('publishes the template current draft using both caller concurrency guards', async () => {
    vi.mocked(repository.getDraftRow).mockResolvedValue(version())
    vi.mocked(repository.publishDraftRow).mockResolvedValue(version(definition(), { status: 'published' }))
    await expect(service.publishIntakeFormTemplateDraft({ templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 3,
      expectedDefinitionHash: version().definition_hash })).resolves.toMatchObject({ status: 'published' })
    expect(repository.publishDraftRow).toHaveBeenCalledWith({ versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 3,
      expectedDefinitionHash: version().definition_hash })
  })

  it.each([null, version(definition(), { template_id: 'other-template' }), version(definition(), { status: 'published' })])('rejects a missing or mismatched current draft before mutation', async (row) => {
    vi.mocked(repository.getDraftRow).mockResolvedValue(row)
    const input = { templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 3 }
    await expect(service.saveIntakeFormTemplateDraft({ ...input, definition: definition() })).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    await expect(service.discardIntakeFormTemplateDraft(input)).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    await expect(service.publishIntakeFormTemplateDraft({ ...input, expectedDefinitionHash: version().definition_hash })).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
    expect(repository.discardDraftRow).not.toHaveBeenCalled()
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it.each([null, version(definition(), { template_id: 'other-template', status: 'published' })])('rejects missing or cross-template duplicate and retirement sources', async (row) => {
    vi.mocked(repository.getVersionRow).mockResolvedValue(row)
    await expect(service.duplicateIntakeFormTemplateFromTemplate({ templateId: 'template-1', sourceVersionId: 'version-1', actorId: 'admin-1',
      key: 'copy', name: 'Copy' })).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    await expect(service.retireIntakeFormTemplateVersion({ templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1' }))
      .rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    expect(repository.createTemplateRow).not.toHaveBeenCalled()
    expect(repository.retireVersionRow).not.toHaveBeenCalled()
  })

  it('duplicates and retires a selected version belonging to the requested template', async () => {
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(definition(), { status: 'published' }))
    vi.mocked(repository.retireVersionRow).mockResolvedValue(version(definition(), { status: 'retired' }))
    vi.mocked(repository.duplicateTemplateRow).mockResolvedValue({ template: template({ key: 'copy' }), draft: version() })
    await expect(service.duplicateIntakeFormTemplateFromTemplate({ templateId: 'template-1', sourceVersionId: 'version-1', actorId: 'admin-1', key: 'copy', name: 'Copy' }))
      .resolves.toMatchObject({ template: { key: 'copy' } })
    await expect(service.retireIntakeFormTemplateVersion({ templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1' }))
      .resolves.toMatchObject({ status: 'retired' })
  })

  it('rejects missing actor before scoped service reads', async () => {
    await expect(service.saveIntakeFormTemplateDraft({ templateId: 'template-1', versionId: 'version-1', actorId: '', expectedLockVersion: 3, definition: definition() }))
      .rejects.toBeInstanceOf(service.IntakeFormValidationError)
    await expect(service.retireIntakeFormTemplateVersion({ templateId: 'template-1', versionId: 'version-1', actorId: '' }))
      .rejects.toBeInstanceOf(service.IntakeFormValidationError)
    expect(repository.getDraftRow).not.toHaveBeenCalled()
    expect(repository.getVersionRow).not.toHaveBeenCalled()
  })

  it('conflicts when a replacement draft resets the old lock counter', async () => {
    vi.mocked(repository.getDraftRow).mockResolvedValue(version(definition(), { id: 'replacement', lock_version: 0 }))
    const input = { templateId: 'template-1', versionId: 'version-1', actorId: 'admin-1', expectedLockVersion: 0 }
    await expect(service.saveIntakeFormTemplateDraft({ ...input, definition: definition() })).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    await expect(service.discardIntakeFormTemplateDraft(input)).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    await expect(service.publishIntakeFormTemplateDraft({ ...input, expectedDefinitionHash: version().definition_hash })).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
    expect(repository.discardDraftRow).not.toHaveBeenCalled()
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('saves structurally valid incomplete drafts with deduplicated diagnostics', async () => {
    const raw = definition(); raw.sections.pop()
    await expect(save(raw)).resolves.toMatchObject({ draft: { lock_version: 4 }, diagnostics: [
      { path: 'sections', message: 'A shared unconditional review and submit path is required' },
    ] })
    expect(repository.saveDraftRow).toHaveBeenCalledWith({ versionId: 'version-1', expectedLockVersion: 3,
      actorId: 'admin-1', definition: raw, definitionHash: hashIntakeFormDefinition(raw) })
  })

  it('returns stable sorted diagnostics for both compiler audiences', async () => {
    const raw = definition()
    raw.sections[0].items.push({ kind: 'field', id: 'duplicate', fieldId: 'client_first_name', requirement: 'optional' })
    raw.sections.splice(1, 0, { id: 'internal', title: 'Internal', audience: 'staff_only', items: [
      { kind: 'field', id: 'staff_email', fieldId: 'client_email', requirement: 'optional' },
    ] })
    const result = await save(raw)
    expect(result.diagnostics).toEqual([
      { path: 'sections.0.items.1.fieldId', message: 'Single-use field "client_first_name" is duplicated' },
      { path: 'sections.0.items.1.requirement', message: 'Cannot weaken the catalog requirement' },
      { path: 'sections.1.items.0.requirement', message: 'Cannot weaken the catalog requirement' },
    ])
    for (const audience of ['client', 'staff'] as const) {
      const compiled = compileIntakeForm(raw, audience)
      expect(compiled.success).toBe(false)
      if (!compiled.success) expect(result.diagnostics).toEqual(compiled.errors)
    }
  })

  it.each([{ schemaVersion: 1 }, { ...definition(), sql: 'DELETE' }])('rejects invalid schema before saving', async (raw) => {
    await expect(save(raw)).rejects.toBeInstanceOf(service.IntakeFormValidationError)
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
  })

  it('rejects non-JSON input without invoking accessors', async () => {
    const getter = vi.fn(() => 'test')
    const raw = Object.defineProperty(definition(), 'key', { enumerable: true, get: getter })
    await expect(save(raw)).rejects.toBeInstanceOf(service.IntakeFormValidationError)
    expect(getter).not.toHaveBeenCalled()
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
  })

  it.each(['Draft changed; refresh and try again', 'Definition changed; refresh and try again'])('maps known persistence conflict: %s', async (message) => {
    vi.mocked(repository.saveDraftRow).mockRejectedValue({ code: '40001', message })
    await expect(save(definition())).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    await expect(save(definition())).rejects.toMatchObject({ code: 'INTAKE_FORM_CONFLICT', message })
  })

  it('preserves unexpected persistence errors', async () => {
    const failure = { code: 'XX000', message: 'unexpected storage failure' }
    vi.mocked(repository.saveDraftRow).mockRejectedValue(failure)
    await expect(save(definition())).rejects.toBe(failure)
  })

  it('does not hide an unexpected database code behind a familiar conflict message', async () => {
    const failure = { code: 'XX000', message: 'Draft changed; refresh and try again' }
    vi.mocked(repository.saveDraftRow).mockRejectedValue(failure)
    await expect(save(definition())).rejects.toBe(failure)
  })

  it.each([{ expectedLockVersion: 2 }, { expectedDefinitionHash: '0'.repeat(64) }])('rejects stale publication before calling the RPC', async (overrides) => {
    await expect(publish(overrides)).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('rejects a stored hash that no longer matches the definition', async () => {
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(definition(), { definition_hash: '0'.repeat(64) }))
    await expect(publish({ expectedDefinitionHash: '0'.repeat(64) })).rejects.toThrow('Definition changed; refresh and try again')
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('blocks publication with diagnostics and exposes stable diagnostics', async () => {
    const raw = definition(); raw.sections.pop()
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(raw))
    await expect(publish({ expectedDefinitionHash: hashIntakeFormDefinition(raw) })).rejects.toMatchObject({
      diagnostics: [{ path: 'sections', message: 'A shared unconditional review and submit path is required' }],
    })
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('publishes through the guarded RPC and excludes staff content from client compilation', async () => {
    const raw = definition()
    raw.sections.splice(1, 0, { id: 'internal', title: 'Private plan', subtitle: 'Staff secret', audience: 'staff_only', items: [
      { kind: 'block', id: 'plan', blockId: 'attorney_plan_structure', helpText: 'Private instructions' },
    ] })
    const row = version(raw)
    vi.mocked(repository.getVersionRow).mockResolvedValue(row)
    vi.mocked(repository.publishDraftRow).mockResolvedValue({ ...row, status: 'published', published_by: 'admin-1', published_at: row.created_at })
    await expect(publish({ expectedDefinitionHash: row.definition_hash })).resolves.toMatchObject({ status: 'published' })
    expect(repository.publishDraftRow).toHaveBeenCalledWith({ versionId: row.id, expectedLockVersion: 3,
      expectedDefinitionHash: row.definition_hash, actorId: 'admin-1' })
    const client = compileIntakeForm(raw, 'client'); const staff = compileIntakeForm(raw, 'staff')
    expect(client.success && staff.success).toBe(true)
    if (client.success && staff.success) {
      expect(client.form.sections.map((section) => section.id)).toEqual(['personal', 'review'])
      expect(JSON.stringify(client.form)).not.toMatch(/Private|Staff secret|internal|attorney_plan_structure/)
      expect(staff.form.sections.map((section) => section.id)).toEqual(['personal', 'internal', 'review'])
    }
  })

  it('maps a race after preflight to a conflict rather than publishing', async () => {
    vi.mocked(repository.publishDraftRow).mockRejectedValue({ code: '40001', message: 'Draft changed; refresh and try again' })
    await expect(publish()).rejects.toBeInstanceOf(service.IntakeFormConflictError)
  })

  it('returns not-found for a missing source', async () => {
    vi.mocked(repository.getVersionRow).mockResolvedValue(null)
    await expect(publish()).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
  })

  it('does not republish an immutable version', async () => {
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(definition(), { status: 'published' }))
    await expect(publish()).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('duplicates into a new key/template and independent version-1 draft', async () => {
    const source = version(definition(), { status: 'published', version: 5 })
    vi.mocked(repository.getVersionRow).mockResolvedValue(source)
    vi.mocked(repository.duplicateTemplateRow).mockImplementation(async (input) => ({
      template: template({ id: 'template-2', key: input.key, name: input.name }),
      draft: version({ ...definition(), key: input.key }, { id: 'version-2', template_id: 'template-2', lock_version: 0 }),
    }))
    const result = await service.duplicateIntakeFormTemplate({ sourceVersionId: source.id, key: 'copy', name: 'Copy', actorId: 'admin-1' })
    expect(result).toMatchObject({ template: { id: 'template-2', key: 'copy' }, draft: {
      id: 'version-2', template_id: 'template-2', version: 1, status: 'draft', lock_version: 0, definition: { key: 'copy' },
    }, diagnostics: [] })
    result.draft.definition.sections[0].title = 'Changed copy'
    expect(source.definition.sections[0].title).toBe('Personal')
    expect(repository.createNextDraftRow).not.toHaveBeenCalled()
    expect(repository.createTemplateRow).not.toHaveBeenCalled()
  })

  it('rejects a duplicate reusing the original template key', async () => {
    await expect(service.duplicateIntakeFormTemplate({ sourceVersionId: 'version-1', key: 'test', name: 'Copy', actorId: 'admin-1' }))
      .rejects.toBeInstanceOf(service.IntakeFormValidationError)
    expect(repository.createTemplateRow).not.toHaveBeenCalled()
  })

  it('creates a structurally valid draft even before it can compile', async () => {
    const raw = definition(); raw.sections.pop()
    vi.mocked(repository.createTemplateRow).mockResolvedValue({ template: template(), draft: version(raw, { lock_version: 0 }) })
    await expect(service.createIntakeFormTemplate({ key: 'test', name: 'Test', definition: raw, actorId: 'admin-1' }))
      .resolves.toMatchObject({ draft: { version: 1 }, diagnostics: [{ path: 'sections' }] })
  })

  it('creates the next draft from a published source with its own diagnostics', async () => {
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(definition(), { status: 'published' }))
    vi.mocked(repository.createNextDraftRow).mockResolvedValue(version(definition(), { id: 'version-next', version: 2, lock_version: 0 }))
    await expect(service.createNextIntakeFormDraft({ sourceVersionId: 'version-1', actorId: 'admin-1' }))
      .resolves.toMatchObject({ draft: { id: 'version-next', version: 2 }, diagnostics: [] })
  })

  it('retires through a status transition without discarding or deleting', async () => {
    const row = version(definition(), { status: 'published' })
    vi.mocked(repository.getVersionRow).mockResolvedValue(row)
    vi.mocked(repository.retireVersionRow).mockResolvedValue({ ...row, status: 'retired' })
    await expect(service.retireIntakeFormVersion({ versionId: row.id, actorId: 'admin-1' })).resolves.toMatchObject({ id: row.id, status: 'retired' })
    expect(repository.retireVersionRow).toHaveBeenCalledWith({ versionId: row.id, actorId: 'admin-1' })
    expect(repository.discardDraftRow).not.toHaveBeenCalled()
  })

  it('archives without changing versions and can unarchive explicitly', async () => {
    vi.mocked(repository.archiveTemplateRow).mockResolvedValue(template())
    await service.archiveIntakeFormTemplate({ templateId: 'template-1', archived: false, actorId: 'admin-1' })
    expect(repository.archiveTemplateRow).toHaveBeenCalledWith({ templateId: 'template-1', archived: false, actorId: 'admin-1' })
    expect(repository.retireVersionRow).not.toHaveBeenCalled()
  })

  it('discards only with an explicit expected lock', async () => {
    vi.mocked(repository.discardDraftRow).mockResolvedValue(version())
    await service.discardIntakeFormDraft({ versionId: 'version-1', expectedLockVersion: 3, actorId: 'admin-1' })
    expect(repository.discardDraftRow).toHaveBeenCalledWith({ versionId: 'version-1', expectedLockVersion: 3, actorId: 'admin-1' })
  })

  it('rejects a missing explicit actor before any mutation', async () => {
    await expect(service.saveIntakeFormDraft({ versionId: 'version-1', expectedLockVersion: 3, definition: definition(), actorId: '' }))
      .rejects.toBeInstanceOf(service.IntakeFormValidationError)
    expect(repository.saveDraftRow).not.toHaveBeenCalled()
  })

  it('returns parsed repository reads without introducing a fallback', async () => {
    vi.mocked(repository.listTemplateRows).mockResolvedValue([template()])
    vi.mocked(repository.getDraftRow).mockResolvedValue(version())
    await expect(service.listIntakeFormTemplates()).resolves.toEqual([template()])
    await expect(service.getIntakeFormTemplate('template-1')).resolves.toEqual(template())
    await expect(service.getIntakeFormVersion('version-1')).resolves.toEqual(version())
    await expect(service.getIntakeFormDraft('template-1')).resolves.toEqual(version())
    vi.mocked(repository.getVersionRow).mockRejectedValue(new Error('Stored intake form version version-1 is invalid'))
    await expect(service.getIntakeFormVersion('version-1')).rejects.toThrow('Stored intake form version version-1 is invalid')
  })

  it('builds key-ordered summaries including archived templates and selects the highest version per status', async () => {
    const archived = template({ id: 'archived', key: 'a_archived', archived_at: '2026-10-08T12:00:00Z' })
    vi.mocked(repository.listTemplateRows).mockResolvedValue([template(), archived])
    vi.mocked(repository.listVersionRows).mockImplementation(async (id) => id === 'archived' ? [] : [
      version(definition(), { id: 'published-old', status: 'published', version: 2 }),
      version(definition(), { id: 'draft-new', version: 7 }),
      version(definition(), { id: 'retired', status: 'retired', version: 8 }),
      version(definition(), { id: 'published-new', status: 'published', version: 6 }),
    ])
    const summaries = await service.listIntakeFormTemplateSummaries()
    expect(summaries.map((summary) => summary.template.key)).toEqual(['a_archived', 'test'])
    expect(summaries[0]).toEqual({ template: archived, draft: null, latestPublished: null, latestVersion: null, lastModifiedAt: archived.updated_at })
    expect(summaries[1]).toMatchObject({ draft: { id: 'draft-new' }, latestPublished: { id: 'published-new' }, latestVersion: { id: 'retired' } })
  })

  it('includes an older retired version in the last-modified aggregate', async () => {
    vi.mocked(repository.listTemplateRows).mockResolvedValue([template()])
    vi.mocked(repository.listVersionRows).mockResolvedValue([
      version(definition(), { id: 'retired-old', status: 'retired', version: 1, updated_at: '2026-10-10T15:00:00Z' }),
      version(definition(), { id: 'published', status: 'published', version: 2, updated_at: '2026-10-09T15:00:00Z' }),
      version(definition(), { id: 'draft', version: 3, updated_at: '2026-10-09T16:00:00Z' }),
    ])
    await expect(service.listIntakeFormTemplateSummaries()).resolves.toMatchObject([
      { draft: { id: 'draft' }, latestPublished: { id: 'published' }, latestVersion: { id: 'draft' }, lastModifiedAt: '2026-10-10T15:00:00Z' },
    ])
  })

  it.each([null, '2026-10-10T15:00:00Z'])('includes template-only archive/restore updates (archived=%s) in last-modified', async archived_at => {
    vi.mocked(repository.listTemplateRows).mockResolvedValue([template({ archived_at, updated_at: '2026-10-10T15:00:00Z' })])
    vi.mocked(repository.listVersionRows).mockResolvedValue([version(definition(), { updated_at: '2026-10-09T15:00:00Z' })])
    await expect(service.listIntakeFormTemplateSummaries()).resolves.toMatchObject([{ lastModifiedAt: '2026-10-10T15:00:00Z' }])
  })

  it('retains discard recency when the latest draft no longer exists', async () => {
    vi.mocked(repository.listTemplateRows).mockResolvedValue([template({ updated_at: '2026-10-10T15:00:00Z' })])
    vi.mocked(repository.listVersionRows).mockResolvedValue([version(definition(), { status: 'published', updated_at: '2026-10-09T15:00:00Z' })])
    await expect(service.listIntakeFormTemplateSummaries()).resolves.toMatchObject([{ draft: null, lastModifiedAt: '2026-10-10T15:00:00Z' }])
  })

  it('returns a parsed editor snapshot with history and propagates storage errors', async () => {
    vi.mocked(repository.listVersionRows).mockResolvedValue([version()])
    vi.mocked(repository.listAuditEventRows).mockResolvedValue([auditEvent()] as never)
    await expect(service.getIntakeFormEditorSnapshot('template-1')).resolves.toEqual({
      template: template(), versions: [version()], draft: version(), auditEvents: [auditEvent()],
    })
    vi.mocked(repository.listVersionRows).mockRejectedValue(new Error('Stored definition is invalid'))
    vi.mocked(repository.listTemplateRows).mockResolvedValue([template()])
    await expect(service.getIntakeFormEditorSnapshot('template-1')).rejects.toThrow('Stored definition is invalid')
    await expect(service.listIntakeFormTemplateSummaries()).rejects.toThrow() // storage failures never become empty summaries
  })

  it('returns null only for an absent editor template', async () => {
    vi.mocked(repository.getTemplateRow).mockResolvedValue(null)
    await expect(service.getIntakeFormEditorSnapshot('missing')).resolves.toBeNull()
    expect(repository.listVersionRows).not.toHaveBeenCalled()
    expect(repository.listAuditEventRows).not.toHaveBeenCalled()
  })

  it('creates a next draft only from a source scoped to the requested template', async () => {
    const input = { templateId: 'template-1', sourceVersionId: 'version-1', actorId: 'admin-1' }
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(definition(), { template_id: 'other-template', status: 'published' }))
    await expect(service.createNextIntakeFormTemplateDraft(input)).rejects.toBeInstanceOf(service.IntakeFormNotFoundError)
    expect(repository.createNextDraftRow).not.toHaveBeenCalled()
    vi.mocked(repository.getVersionRow).mockResolvedValue(version(definition(), { status: 'published' }))
    vi.mocked(repository.createNextDraftRow).mockRejectedValue({ code: 'P0001', message: 'Template already has a draft' })
    await expect(service.createNextIntakeFormTemplateDraft(input)).rejects.toBeInstanceOf(service.IntakeFormConflictError)
    vi.mocked(repository.createNextDraftRow).mockResolvedValue(version(definition(), { version: 2, lock_version: 0 }))
    await expect(service.createNextIntakeFormTemplateDraft(input)).resolves.toMatchObject({ draft: { version: 2 }, diagnostics: [] })
  })

  it('maps a raced duplication source to a sanitized typed conflict', async () => {
    vi.mocked(repository.duplicateTemplateRow).mockRejectedValue({ code: '40001', message: 'Source changed; refresh and try again' })
    await expect(service.duplicateIntakeFormTemplate({ sourceVersionId: 'version-1', actorId: 'admin-1', key: 'copy', name: 'Copy' }))
      .rejects.toMatchObject({ code: 'INTAKE_FORM_CONFLICT', message: 'Source changed; refresh and try again' })
  })
})
