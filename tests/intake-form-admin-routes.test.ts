import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/apiAuth', () => ({ requireAdministrator: auth }))
vi.mock('@/lib/intake/forms/adminService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/intake/forms/adminService')>()
  return { ...actual, ...Object.fromEntries([
    'listIntakeFormTemplateSummaries', 'createIntakeFormTemplate', 'getIntakeFormEditorSnapshot', 'archiveIntakeFormTemplate',
    'createNextIntakeFormTemplateDraft',
    'getIntakeFormDraft', 'saveIntakeFormTemplateDraft', 'discardIntakeFormTemplateDraft',
    'publishIntakeFormTemplateDraft', 'duplicateIntakeFormTemplateFromTemplate', 'retireIntakeFormTemplateVersion',
  ].map((name) => [name, vi.fn()])) }
})

import * as service from '@/lib/intake/forms/adminService'
import * as repository from '@/lib/intake/forms/repository'
import * as list from '@/app/api/admin/settings/intake-forms/route'
import * as template from '@/app/api/admin/settings/intake-forms/[templateId]/route'
import * as draft from '@/app/api/admin/settings/intake-forms/[templateId]/draft/route'
import * as publish from '@/app/api/admin/settings/intake-forms/[templateId]/publish/route'
import * as duplicate from '@/app/api/admin/settings/intake-forms/[templateId]/duplicate/route'
import * as retire from '@/app/api/admin/settings/intake-forms/[templateId]/versions/[versionId]/retire/route'

const templateId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'
const definition = { schemaVersion: 1, key: 'test' }
const diagnostics = [{ path: 'sections', message: 'A shared unconditional review and submit path is required' }]
type Context = { params: Promise<{ templateId: string; versionId: string }> }
type Handler = (req: Request, context: Context) => Promise<Response>
const cases = [
  { name: 'list GET', method: 'GET', handler: list.GET, operation: 'listIntakeFormTemplateSummaries', body: undefined, input: undefined, result: [{ template: { id: templateId }, draft: null, latestPublished: null, latestVersion: null }], response: { templates: [{ template: { id: templateId }, draft: null, latestPublished: null, latestVersion: null }] }, status: 200 },
  { name: 'list POST', method: 'POST', handler: list.POST, operation: 'createIntakeFormTemplate', body: { key: 'test', name: 'Test', definition }, input: { key: 'test', name: 'Test', definition, actorId }, result: { template: { id: templateId }, draft: { id: versionId }, diagnostics }, status: 201 },
  { name: 'template GET', method: 'GET', handler: template.GET, operation: 'getIntakeFormEditorSnapshot', body: undefined, input: templateId, result: { template: { id: templateId }, versions: [], draft: null, auditEvents: [] }, status: 200 },
  { name: 'template PATCH', method: 'PATCH', handler: template.PATCH, operation: 'archiveIntakeFormTemplate', body: { archived: false }, input: { templateId, actorId, archived: false }, result: { id: templateId, archived_at: null }, response: { template: { id: templateId, archived_at: null } }, status: 200 },
  { name: 'draft GET', method: 'GET', handler: draft.GET, operation: 'getIntakeFormDraft', body: undefined, input: templateId, result: { id: versionId }, response: { draft: { id: versionId } }, status: 200 },
  { name: 'draft POST', method: 'POST', handler: draft.POST, operation: 'createNextIntakeFormTemplateDraft', body: { sourceVersionId: versionId }, input: { templateId, sourceVersionId: versionId, actorId }, result: { draft: { id: versionId, version: 2 }, diagnostics: [] }, status: 201 },
  { name: 'draft PUT', method: 'PUT', handler: draft.PUT, operation: 'saveIntakeFormTemplateDraft', body: { versionId, expectedLockVersion: 3, definition }, input: { templateId, versionId, actorId, expectedLockVersion: 3, definition }, result: { draft: { id: versionId, lock_version: 4 }, diagnostics }, status: 200 },
  { name: 'draft DELETE', method: 'DELETE', handler: draft.DELETE, operation: 'discardIntakeFormTemplateDraft', body: { versionId, expectedLockVersion: 3 }, input: { templateId, versionId, actorId, expectedLockVersion: 3 }, result: { id: versionId }, response: { draft: { id: versionId } }, status: 200 },
  { name: 'publish POST', method: 'POST', handler: publish.POST, operation: 'publishIntakeFormTemplateDraft', body: { versionId, expectedLockVersion: 3, expectedDefinitionHash: 'a'.repeat(64) }, input: { templateId, versionId, actorId, expectedLockVersion: 3, expectedDefinitionHash: 'a'.repeat(64) }, result: { id: versionId, status: 'published' }, response: { version: { id: versionId, status: 'published' } }, status: 200 },
  { name: 'duplicate POST', method: 'POST', handler: duplicate.POST, operation: 'duplicateIntakeFormTemplateFromTemplate', body: { sourceVersionId: versionId, key: 'copy', name: 'Copy' }, input: { templateId, actorId, sourceVersionId: versionId, key: 'copy', name: 'Copy' }, result: { template: { key: 'copy' }, draft: { version: 1 }, diagnostics: [] }, status: 201 },
  { name: 'retire POST', method: 'POST', handler: retire.POST, operation: 'retireIntakeFormTemplateVersion', body: {}, input: { templateId, versionId, actorId }, result: { id: versionId, status: 'retired' }, response: { version: { id: versionId, status: 'retired' } }, status: 200 },
] as const
const request = (method: string, body: unknown) => new Request('http://app.test/api/admin/settings/intake-forms', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
})
const context = (): Context => ({ params: Promise.resolve({ templateId, versionId }) })
const operations = () => cases.map((entry) => vi.mocked(service[entry.operation]))

beforeEach(() => {
  vi.resetAllMocks()
  auth.mockResolvedValue({ err: null, userId: actorId, user: { id: actorId } })
})

describe.each(cases)('$name', (entry) => {
  const invoke = (req = request(entry.method, entry.body), ctx = context()) => (entry.handler as Handler)(req, ctx)
  const operation = () => vi.mocked(service[entry.operation])

  it.each([{ status: 401, role: 'anonymous' }, { status: 403, role: 'attorney' }, { status: 403, role: 'staff' }])('rejects $role before body, params, or service access', async ({ status }) => {
    const denied = Response.json({ error: status === 401 ? 'Unauthorized' : 'Administrator role required' }, { status })
    auth.mockResolvedValue({ err: denied, userId: null, user: null })
    const req = request(entry.method, entry.body)
    const readBody = vi.spyOn(req, 'json').mockRejectedValue(new Error('must not read body'))
    const readParams = vi.fn(() => { throw new Error('must not read params') })
    const ctx = Object.defineProperty({}, 'params', { get: readParams }) as Context
    expect(await invoke(req, ctx)).toBe(denied)
    expect(auth).toHaveBeenCalledWith(req)
    expect(readBody).not.toHaveBeenCalled()
    expect(readParams).not.toHaveBeenCalled()
    for (const method of operations()) expect(method).not.toHaveBeenCalled()
  })

  it('returns administrator success and invokes exactly one service method after authorization', async () => {
    operation().mockResolvedValue(entry.result as never)
    const req = request(entry.method, entry.body)
    const readBody = vi.spyOn(req, 'json')
    const response = await invoke(req)
    expect(response.status).toBe(entry.status)
    expect(await response.json()).toEqual('response' in entry ? entry.response : entry.result)
    if (entry.input === undefined) expect(operation()).toHaveBeenCalledWith()
    else expect(operation()).toHaveBeenCalledWith(entry.input)
    expect(operations().reduce((count, method) => count + method.mock.calls.length, 0)).toBe(1)
    expect(auth.mock.invocationCallOrder[0]).toBeLessThan(operation().mock.invocationCallOrder[0])
    if (entry.body !== undefined) expect(auth.mock.invocationCallOrder[0]).toBeLessThan(readBody.mock.invocationCallOrder[0])
  })

  it('sanitizes unexpected errors and spoofed typed errors', async () => {
    for (const error of [new Error('Supabase SQL service_role secret raw definition'), { code: 'INTAKE_FORM_CONFLICT', message: 'secret' }]) {
      operation().mockRejectedValue(error)
      const response = await invoke()
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Unable to process intake form request', code: 'INTAKE_FORM_INTERNAL' })
    }
  })

  it.each([
    { error: new service.IntakeFormNotFoundError('private record id'), status: 404, body: { error: 'Intake form resource not found', code: 'INTAKE_FORM_NOT_FOUND' } },
    { error: new service.IntakeFormConflictError(), status: 409, body: { error: 'Draft changed; refresh and try again', code: 'INTAKE_FORM_CONFLICT' } },
    { error: new service.IntakeFormConflictError('Definition changed; refresh and try again'), status: 409, body: { error: 'Definition changed; refresh and try again', code: 'INTAKE_FORM_CONFLICT' } },
    { error: new service.IntakeFormValidationError('private definition', diagnostics), status: 422, body: { error: 'Invalid intake form request', code: 'INTAKE_FORM_VALIDATION', diagnostics } },
  ])('maps typed errors to $status', async ({ error, status, body }) => {
    operation().mockRejectedValue(error)
    const response = await invoke()
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
  })

  if (entry.name !== 'list GET' && entry.name !== 'list POST') {
    it('rejects malformed route params before service access', async () => {
      for (const params of [{ templateId: 'bad', versionId }, { templateId: null, versionId }, null,
        ...(entry.name === 'retire POST' ? [{ templateId, versionId: 'bad' }] : [])]) {
        const response = await invoke(request(entry.method, entry.body), { params: Promise.resolve(params) } as Context)
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid intake form request', code: 'INTAKE_FORM_BAD_REQUEST' })
      }
      expect(operation()).not.toHaveBeenCalled()
    })
  }

  if (entry.body !== undefined) {
    it('rejects malformed JSON, unknown fields, wrong types, and missing fields before service access', async () => {
      const malformed = new Request('http://app.test/x', { method: entry.method, body: '{broken' })
      expect((await invoke(malformed)).status).toBe(400)
      const invalid: unknown[] = [null, [], 'text', { ...entry.body, actorId }, { ...entry.body, unknown: true }]
      for (const field of Object.keys(entry.body)) {
        const missing = { ...entry.body } as Record<string, unknown>; delete missing[field]
        invalid.push(missing, { ...entry.body, [field]: null })
        if (field.endsWith('Id')) invalid.push({ ...entry.body, [field]: 'not-a-uuid' })
      }
      if ('expectedLockVersion' in entry.body) invalid.push(...[-1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1].map((expectedLockVersion) => ({ ...entry.body, expectedLockVersion })))
      if ('expectedDefinitionHash' in entry.body) invalid.push({ ...entry.body, expectedDefinitionHash: 'A'.repeat(64) })
      for (const body of invalid) {
        const response = await invoke(request(entry.method, body))
        expect(response.status, JSON.stringify(body)).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid intake form request', code: 'INTAKE_FORM_BAD_REQUEST' })
      }
      expect(operation()).not.toHaveBeenCalled()
    })
  }
})

it.each([{ handler: template.GET, operation: 'getIntakeFormEditorSnapshot' }, { handler: draft.GET, operation: 'getIntakeFormDraft' }] as const)('returns 404 for an absent read resource', async ({ handler, operation }) => {
  vi.mocked(service[operation]).mockResolvedValue(null)
  const response = await handler(request('GET', undefined), context())
  expect(response.status).toBe(404)
})

it('archives explicitly with the same boolean contract used for unarchive', async () => {
  vi.mocked(service.archiveIntakeFormTemplate).mockResolvedValue({ archived_at: '2026-10-08T12:00:00Z' } as never)
  expect((await template.PATCH(request('PATCH', { archived: true }), context())).status).toBe(200)
  expect(service.archiveIntakeFormTemplate).toHaveBeenCalledWith({ templateId, actorId, archived: true })
})

it('uses the node runtime for all lifecycle routes', () => {
  for (const route of [list, template, draft, publish, duplicate, retire]) expect(route.runtime).toBe('nodejs')
})

it('returns 409 for a stale draft identity through the real scoped service without mutation', async () => {
  const actual = await vi.importActual<typeof service>('@/lib/intake/forms/adminService')
  const read = vi.spyOn(repository, 'getDraftRow').mockResolvedValue({ id: 'replacement', template_id: templateId, status: 'draft', lock_version: 0 } as never)
  const save = vi.spyOn(repository, 'saveDraftRow')
  const discard = vi.spyOn(repository, 'discardDraftRow')
  const publishRow = vi.spyOn(repository, 'publishDraftRow')
  try {
    vi.mocked(service.saveIntakeFormTemplateDraft).mockImplementation(actual.saveIntakeFormTemplateDraft)
    vi.mocked(service.discardIntakeFormTemplateDraft).mockImplementation(actual.discardIntakeFormTemplateDraft)
    vi.mocked(service.publishIntakeFormTemplateDraft).mockImplementation(actual.publishIntakeFormTemplateDraft)
    for (const entry of cases.filter((entry) => ['draft PUT', 'draft DELETE', 'publish POST'].includes(entry.name))) {
      const response = await (entry.handler as Handler)(request(entry.method, { ...entry.body, expectedLockVersion: 0 }), context())
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'Draft changed; refresh and try again', code: 'INTAKE_FORM_CONFLICT' })
    }
    expect(save).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
    expect(publishRow).not.toHaveBeenCalled()
  } finally { read.mockRestore(); save.mockRestore(); discard.mockRestore(); publishRow.mockRestore() }
})

it('returns 404 for cross-template next-draft, duplicate and retirement through the real scoped service', async () => {
  const actual = await vi.importActual<typeof service>('@/lib/intake/forms/adminService')
  const read = vi.spyOn(repository, 'getVersionRow').mockResolvedValue({ id: versionId, template_id: 'other-template', status: 'published' } as never)
  const create = vi.spyOn(repository, 'createTemplateRow')
  const retireRow = vi.spyOn(repository, 'retireVersionRow')
  try {
    vi.mocked(service.duplicateIntakeFormTemplateFromTemplate).mockImplementation(actual.duplicateIntakeFormTemplateFromTemplate)
    vi.mocked(service.createNextIntakeFormTemplateDraft).mockImplementation(actual.createNextIntakeFormTemplateDraft)
    vi.mocked(service.retireIntakeFormTemplateVersion).mockImplementation(actual.retireIntakeFormTemplateVersion)
    for (const entry of cases.filter((entry) => ['draft POST', 'duplicate POST', 'retire POST'].includes(entry.name))) {
      const response = await (entry.handler as Handler)(request(entry.method, entry.body), context())
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Intake form resource not found', code: 'INTAKE_FORM_NOT_FOUND' })
    }
    expect(create).not.toHaveBeenCalled()
    expect(retireRow).not.toHaveBeenCalled()
  } finally { read.mockRestore(); create.mockRestore(); retireRow.mockRestore() }
})

it('returns 409 when the next draft already exists through the real service', async () => {
  const actual = await vi.importActual<typeof service>('@/lib/intake/forms/adminService')
  const read = vi.spyOn(repository, 'getVersionRow').mockResolvedValue({ id: versionId, template_id: templateId, status: 'published' } as never)
  const create = vi.spyOn(repository, 'createNextDraftRow').mockRejectedValue({ code: 'P0001', message: 'Template already has a draft' })
  try {
    vi.mocked(service.createNextIntakeFormTemplateDraft).mockImplementation(actual.createNextIntakeFormTemplateDraft)
    const response = await draft.POST(request('POST', { sourceVersionId: versionId }), context())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Draft changed; refresh and try again', code: 'INTAKE_FORM_CONFLICT' })
  } finally { read.mockRestore(); create.mockRestore() }
})

it('sanitizes a raced duplicate source conflict without exposing persistence text', async () => {
  vi.mocked(service.duplicateIntakeFormTemplateFromTemplate).mockRejectedValue(new service.IntakeFormConflictError('Source changed; refresh and try again'))
  const response = await duplicate.POST(request('POST', { sourceVersionId: versionId, key: 'copy', name: 'Copy' }), context())
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'Draft changed; refresh and try again', code: 'INTAKE_FORM_CONFLICT' })
})
