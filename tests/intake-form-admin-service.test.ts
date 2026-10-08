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
  retireVersionRow: vi.fn(), archiveTemplateRow: vi.fn(), discardDraftRow: vi.fn(),
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
    vi.mocked(repository.createTemplateRow).mockResolvedValue({ template: template({ key: 'copy' }), draft: version() })
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
    vi.mocked(repository.createTemplateRow).mockImplementation(async (input) => ({
      template: template({ id: 'template-2', key: input.key, name: input.name }),
      draft: version(input.definition, { id: 'version-2', template_id: 'template-2', lock_version: 0 }),
    }))
    const result = await service.duplicateIntakeFormTemplate({ sourceVersionId: source.id, key: 'copy', name: 'Copy', actorId: 'admin-1' })
    expect(result).toMatchObject({ template: { id: 'template-2', key: 'copy' }, draft: {
      id: 'version-2', template_id: 'template-2', version: 1, status: 'draft', lock_version: 0, definition: { key: 'copy' },
    }, diagnostics: [] })
    result.draft.definition.sections[0].title = 'Changed copy'
    expect(source.definition.sections[0].title).toBe('Personal')
    expect(repository.createNextDraftRow).not.toHaveBeenCalled()
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
})
