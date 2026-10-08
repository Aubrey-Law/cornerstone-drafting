import 'server-only'
import { z } from 'zod'
import { compileIntakeForm, type IntakeFormDiagnostic } from './compiler'
import { canonicalizeIntakeFormDefinition, hashIntakeFormDefinition } from './hash'
import * as repository from './repository'
import type { IntakeFormDefinition } from './types'
import type { IntakeFormEditorSnapshot, IntakeFormTemplateSummary, IntakeFormVersionRow } from './persistenceTypes'

export class IntakeFormConflictError extends Error {
  readonly code = 'INTAKE_FORM_CONFLICT'
  constructor(message = 'Draft changed; refresh and try again') { super(message); this.name = 'IntakeFormConflictError' }
}
export class IntakeFormValidationError extends Error {
  readonly code = 'INTAKE_FORM_VALIDATION'
  constructor(message: string, readonly diagnostics: IntakeFormDiagnostic[] = []) { super(message); this.name = 'IntakeFormValidationError' }
}
export class IntakeFormNotFoundError extends Error {
  readonly code = 'INTAKE_FORM_NOT_FOUND'
  constructor(message = 'Intake form resource not found') { super(message); this.name = 'IntakeFormNotFoundError' }
}

function requireActor(actorId: string): void {
  if (typeof actorId !== 'string' || !actorId.trim()) throw new IntakeFormValidationError('Explicit actorId is required')
}
function requireLock(lock: number): void {
  if (!Number.isSafeInteger(lock) || lock < 0) throw new IntakeFormValidationError('Expected lock version is required')
}
function parseDefinition(raw: unknown): IntakeFormDefinition {
  try { return canonicalizeIntakeFormDefinition(raw) }
  catch (error) {
    throw new IntakeFormValidationError(error instanceof Error ? error.message : 'Invalid intake form definition')
  }
}
function compileDiagnostics(definition: IntakeFormDefinition): IntakeFormDiagnostic[] {
  const diagnostics = new Map<string, IntakeFormDiagnostic>()
  for (const audience of ['client', 'staff'] as const) {
    const result = compileIntakeForm(definition, audience)
    if (!result.success) for (const diagnostic of result.errors) diagnostics.set(JSON.stringify([diagnostic.path, diagnostic.message]), diagnostic)
  }
  return [...diagnostics.values()].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }) || a.message.localeCompare(b.message, 'en'))
}
async function mutate<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error &&
      error.code === 'P0001' && error.message === 'Template already has a draft') {
      throw new IntakeFormConflictError()
    }
    if (error && typeof error === 'object' && 'message' in error && 'code' in error && error.code === '40001') {
      const message = error.message
      if (message === 'Draft changed; refresh and try again' || message === 'Definition changed; refresh and try again' || message === 'Source changed; refresh and try again') {
        throw new IntakeFormConflictError(message)
      }
    }
    throw error
  }
}
async function requireVersion(versionId: string): Promise<IntakeFormVersionRow> {
  const row = await repository.getVersionRow(versionId)
  if (!row) throw new IntakeFormNotFoundError('Intake form version not found')
  return row
}
async function requireDefinitionIdentity(templateId: string, definition: IntakeFormDefinition): Promise<void> {
  const template = await repository.getTemplateRow(templateId)
  if (!template) throw new IntakeFormNotFoundError('Intake form template not found')
  if (definition.key !== template.key) throw new IntakeFormValidationError('Definition key must match the template key')
}

export const listIntakeFormTemplates = repository.listTemplateRows
export const getIntakeFormTemplate = repository.getTemplateRow
export const getIntakeFormTemplateByKey = repository.getTemplateRowByKey
export const getIntakeFormVersion = repository.getVersionRow
export const getIntakeFormDraft = repository.getDraftRow
export const listIntakeFormVersions = repository.listVersionRows
export async function listIntakeFormAuditEvents(templateId: string, limit = 50) {
  return repository.listAuditEventRows(templateId, limit)
}

function latestVersion(versions: IntakeFormVersionRow[], status?: IntakeFormVersionRow['status']): IntakeFormVersionRow | null {
  return versions.reduce<IntakeFormVersionRow | null>((latest, row) =>
    (!status || row.status === status) && (!latest || row.version > latest.version) ? row : latest, null)
}
export async function listIntakeFormTemplateSummaries(): Promise<IntakeFormTemplateSummary[]> {
  const templates = await repository.listTemplateRows()
  templates.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  return Promise.all(templates.map(async (template) => {
    const versions = await repository.listVersionRows(template.id)
    return { template, draft: latestVersion(versions, 'draft'), latestPublished: latestVersion(versions, 'published'), latestVersion: latestVersion(versions) }
  }))
}
export async function getIntakeFormEditorSnapshot(templateId: string): Promise<IntakeFormEditorSnapshot | null> {
  const template = await repository.getTemplateRow(templateId)
  if (!template) return null
  const [versions, auditEvents] = await Promise.all([
    repository.listVersionRows(templateId), repository.listAuditEventRows(templateId),
  ])
  return { template, versions, draft: latestVersion(versions, 'draft'), auditEvents }
}

type Actor = { actorId: string }
type VersionInput = Actor & { versionId: string }
export type CreateIntakeFormTemplateInput = Actor & { key: string; name: string; description?: string | null; definition: unknown }
const metadataSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), name: z.string().trim().min(1).max(160),
  description: z.string().max(600).nullable().optional(),
})
export async function createIntakeFormTemplate(input: CreateIntakeFormTemplateInput) {
  requireActor(input.actorId)
  const metadata = metadataSchema.safeParse(input)
  if (!metadata.success) throw new IntakeFormValidationError('Invalid intake form template metadata')
  const definition = parseDefinition(input.definition)
  if (definition.key !== input.key) throw new IntakeFormValidationError('Definition key must match the template key')
  const diagnostics = compileDiagnostics(definition)
  const result = await mutate(() => repository.createTemplateRow({ ...metadata.data, definition,
    definitionHash: hashIntakeFormDefinition(definition), actorId: input.actorId }))
  return { ...result, diagnostics }
}
export async function saveIntakeFormDraft(input: VersionInput & { expectedLockVersion: number; definition: unknown }) {
  requireActor(input.actorId); requireLock(input.expectedLockVersion)
  const definition = parseDefinition(input.definition)
  const row = await repository.getVersionRow(input.versionId)
  if (!row || row.status !== 'draft' || row.lock_version !== input.expectedLockVersion) throw new IntakeFormConflictError()
  await requireDefinitionIdentity(row.template_id, definition)
  const diagnostics = compileDiagnostics(definition)
  const draft = await mutate(() => repository.saveDraftRow({ ...input, definition, definitionHash: hashIntakeFormDefinition(definition) }))
  return { draft, diagnostics }
}
export async function createNextIntakeFormDraft(input: Actor & { sourceVersionId: string }) {
  requireActor(input.actorId)
  const source = await requireVersion(input.sourceVersionId)
  if (source.status === 'draft') throw new IntakeFormValidationError('Published or retired source version required')
  const draft = await mutate(() => repository.createNextDraftRow(input))
  return { draft, diagnostics: compileDiagnostics(draft.definition) }
}
export async function publishIntakeFormDraft(input: VersionInput & { expectedLockVersion: number; expectedDefinitionHash: string }) {
  requireActor(input.actorId); requireLock(input.expectedLockVersion)
  const row = await requireVersion(input.versionId)
  if (row.status !== 'draft' || row.lock_version !== input.expectedLockVersion) throw new IntakeFormConflictError()
  if (row.definition_hash !== input.expectedDefinitionHash || hashIntakeFormDefinition(row.definition) !== row.definition_hash) {
    throw new IntakeFormConflictError('Definition changed; refresh and try again')
  }
  await requireDefinitionIdentity(row.template_id, row.definition)
  const diagnostics = compileDiagnostics(row.definition)
  if (diagnostics.length) throw new IntakeFormValidationError('Intake form cannot be published until compiler diagnostics are resolved', diagnostics)
  return mutate(() => repository.publishDraftRow(input))
}
export async function retireIntakeFormVersion(input: VersionInput) {
  requireActor(input.actorId)
  const row = await requireVersion(input.versionId)
  if (row.status !== 'published') throw new IntakeFormValidationError('Published version required')
  return mutate(() => repository.retireVersionRow(input))
}
export async function archiveIntakeFormTemplate(input: Actor & { templateId: string; archived: boolean }) {
  requireActor(input.actorId)
  if (typeof input.archived !== 'boolean') throw new IntakeFormValidationError('Archive flag is required')
  if (!await repository.getTemplateRow(input.templateId)) throw new IntakeFormNotFoundError('Intake form template not found')
  return mutate(() => repository.archiveTemplateRow(input))
}
export async function discardIntakeFormDraft(input: VersionInput & { expectedLockVersion: number }) {
  requireActor(input.actorId); requireLock(input.expectedLockVersion)
  return mutate(() => repository.discardDraftRow(input))
}
export async function duplicateIntakeFormTemplate(input: Actor & { sourceVersionId: string; key: string; name: string; description?: string | null }) {
  requireActor(input.actorId)
  const metadata = metadataSchema.safeParse(input)
  if (!metadata.success) throw new IntakeFormValidationError('Invalid intake form template metadata')
  const source = await requireVersion(input.sourceVersionId)
  const sourceTemplate = await repository.getTemplateRow(source.template_id)
  if (!sourceTemplate) throw new IntakeFormNotFoundError('Intake form template not found')
  if (input.key === sourceTemplate.key) throw new IntakeFormValidationError('Duplicate requires a new template key')
  const result = await mutate(() => repository.duplicateTemplateRow({ ...metadata.data,
    sourceVersionId: input.sourceVersionId, actorId: input.actorId }))
  return { ...result, diagnostics: compileDiagnostics(result.draft.definition) }
}

type TemplateInput = Actor & { templateId: string }
async function requireTemplateDraft(input: TemplateInput & { versionId: string }): Promise<IntakeFormVersionRow> {
  requireActor(input.actorId)
  const draft = await repository.getDraftRow(input.templateId)
  if (!draft || draft.template_id !== input.templateId || draft.status !== 'draft') throw new IntakeFormNotFoundError()
  if (draft.id !== input.versionId) throw new IntakeFormConflictError()
  return draft
}
async function requireTemplateVersion(input: TemplateInput, versionId: string): Promise<void> {
  requireActor(input.actorId)
  const version = await requireVersion(versionId)
  if (version.template_id !== input.templateId) throw new IntakeFormNotFoundError()
}

export async function createNextIntakeFormTemplateDraft(input: TemplateInput & { sourceVersionId: string }) {
  await requireTemplateVersion(input, input.sourceVersionId)
  return createNextIntakeFormDraft({ sourceVersionId: input.sourceVersionId, actorId: input.actorId })
}

/** Resolve the single draft within the requested template before the guarded RPC. */
export async function saveIntakeFormTemplateDraft(input: TemplateInput & { versionId: string; expectedLockVersion: number; definition: unknown }) {
  const draft = await requireTemplateDraft(input)
  return saveIntakeFormDraft({ versionId: draft.id, actorId: input.actorId,
    expectedLockVersion: input.expectedLockVersion, definition: input.definition })
}
export async function discardIntakeFormTemplateDraft(input: TemplateInput & { versionId: string; expectedLockVersion: number }) {
  const draft = await requireTemplateDraft(input)
  return discardIntakeFormDraft({ versionId: draft.id, actorId: input.actorId, expectedLockVersion: input.expectedLockVersion })
}
export async function publishIntakeFormTemplateDraft(input: TemplateInput & { versionId: string; expectedLockVersion: number; expectedDefinitionHash: string }) {
  const draft = await requireTemplateDraft(input)
  return publishIntakeFormDraft({ versionId: draft.id, actorId: input.actorId,
    expectedLockVersion: input.expectedLockVersion, expectedDefinitionHash: input.expectedDefinitionHash })
}
export async function duplicateIntakeFormTemplateFromTemplate(input: TemplateInput & { sourceVersionId: string; key: string; name: string; description?: string | null }) {
  await requireTemplateVersion(input, input.sourceVersionId)
  return duplicateIntakeFormTemplate({ sourceVersionId: input.sourceVersionId, key: input.key,
    name: input.name, description: input.description, actorId: input.actorId })
}
export async function retireIntakeFormTemplateVersion(input: TemplateInput & { versionId: string }) {
  await requireTemplateVersion(input, input.versionId)
  return retireIntakeFormVersion({ versionId: input.versionId, actorId: input.actorId })
}
