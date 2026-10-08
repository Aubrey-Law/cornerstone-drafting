import 'server-only'
import { z } from 'zod'
import type { Database, Json } from '@aubrey-law/db-types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { hashIntakeFormDefinition } from './hash'
import { parseIntakeFormDefinition } from './schema'
import type { IntakeFormDefinition } from './types'
import type { IntakeFormTemplateRow, IntakeFormVersionRow } from './persistenceTypes'

const templateSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), description: z.string().nullable(), archived_at: z.string().nullable(),
  created_by: z.string(), created_at: z.string(), updated_at: z.string(),
}).strict()
const versionMetadataSchema = z.object({
  id: z.string(), template_id: z.string(), version: z.number().int().positive(), status: z.enum(['draft', 'published', 'retired']),
  definition_hash: z.string().regex(/^[0-9a-f]{64}$/), lock_version: z.number().int().nonnegative(), created_by: z.string(),
  published_by: z.string().nullable(), created_at: z.string(), updated_at: z.string(), published_at: z.string().nullable(),
}).strict()

function parseTemplate(raw: unknown): IntakeFormTemplateRow {
  const result = templateSchema.safeParse(raw)
  if (!result.success) throw new Error('Invalid intake form lifecycle response')
  return result.data
}

/** No raw database JSON crosses this module's boundary. */
function parseVersion(raw: unknown): IntakeFormVersionRow {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const { definition, ...metadata } = record
  const result = versionMetadataSchema.safeParse(metadata)
  const parsed = parseIntakeFormDefinition(definition)
  if (!result.success || !parsed.success || hashIntakeFormDefinition(parsed.data) !== result.data.definition_hash) {
    throw new Error(`Stored intake form version ${String(record.id ?? 'unknown')} is invalid`)
  }
  return { ...result.data, definition: parsed.data }
}

function mutationVersion(raw: unknown, definition: IntakeFormDefinition): IntakeFormVersionRow {
  const metadata = versionMetadataSchema.safeParse(raw)
  if (!metadata.success) throw new Error('Invalid intake form lifecycle response')
  return parseVersion({ ...metadata.data, definition })
}

type Functions = Database['public']['Functions']
type LifecycleFunction = 'create_intake_form_template' | 'save_intake_form_draft' | 'create_next_intake_form_draft'
  | 'publish_intake_form_draft' | 'retire_intake_form_version' | 'archive_intake_form_template' | 'discard_intake_form_draft'
async function rpc<N extends LifecycleFunction>(name: N, args: Functions[N]['Args']): Promise<Json> {
  const { data, error } = await getAdminClient().rpc(name, args)
  if (error) throw error
  if (data === null) throw new Error('Invalid intake form lifecycle response')
  return data
}

export async function listTemplateRows(): Promise<IntakeFormTemplateRow[]> {
  const { data, error } = await getAdminClient().from('intake_form_templates').select('*').order('key')
  if (error) throw error
  return (data ?? []).map(parseTemplate)
}
export async function getTemplateRow(templateId: string): Promise<IntakeFormTemplateRow | null> {
  const { data, error } = await getAdminClient().from('intake_form_templates').select('*').eq('id', templateId).maybeSingle()
  if (error) throw error
  return data === null ? null : parseTemplate(data)
}
/** A unique-key lookup cannot lose a template behind an unrelated-row API limit. */
export async function getTemplateRowByKey(key: string): Promise<IntakeFormTemplateRow | null> {
  const { data, error } = await getAdminClient().from('intake_form_templates').select('*').eq('key', key).maybeSingle()
  if (error) throw error
  return data === null ? null : parseTemplate(data)
}
export async function getVersionRow(versionId: string): Promise<IntakeFormVersionRow | null> {
  const { data, error } = await getAdminClient().from('intake_form_versions').select('*').eq('id', versionId).maybeSingle()
  if (error) throw error
  return data === null ? null : parseVersion(data)
}
export async function getDraftRow(templateId: string): Promise<IntakeFormVersionRow | null> {
  const { data, error } = await getAdminClient().from('intake_form_versions').select('*')
    .eq('template_id', templateId).eq('status', 'draft').maybeSingle()
  if (error) throw error
  return data === null ? null : parseVersion(data)
}
export async function listVersionRows(templateId: string): Promise<IntakeFormVersionRow[]> {
  const versions: IntakeFormVersionRow[] = []
  let expectedCount: number | undefined
  for (;;) {
    const { data, error, count } = await getAdminClient().from('intake_form_versions').select('*', { count: 'exact' })
      .eq('template_id', templateId).order('version').range(versions.length, versions.length + 99)
    if (error) throw error
    const page = (data ?? []).map(parseVersion)
    if (count === null || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid intake form lifecycle response')
    if (expectedCount !== undefined && count !== expectedCount) throw new Error('Stored intake form version list changed; retry')
    expectedCount = count
    versions.push(...page)
    if (versions.length === count) return versions
    if (!page.length || versions.length > count) throw new Error('Incomplete intake form version list')
  }
}

type Actor = { actorId: string }
type VersionInput = Actor & { versionId: string }
export type CreateTemplateRowInput = Actor & {
  key: string; name: string; description?: string | null; definition: IntakeFormDefinition; definitionHash: string
}
export async function createTemplateRow(input: CreateTemplateRowInput): Promise<{ template: IntakeFormTemplateRow; draft: IntakeFormVersionRow }> {
  const draft = mutationVersion(await rpc('create_intake_form_template', {
    p_actor_id: input.actorId, p_key: input.key, p_name: input.name,
    // Generated RPC Args cannot express nullable SQL text parameters.
    p_description: (input.description ?? null) as unknown as string,
    p_definition: input.definition as unknown as Json, p_definition_hash: input.definitionHash,
  }), input.definition)
  const template = await getTemplateRow(draft.template_id)
  if (!template) throw new Error('Created intake form template is unavailable')
  return { template, draft }
}
export async function saveDraftRow(input: VersionInput & {
  expectedLockVersion: number; definition: IntakeFormDefinition; definitionHash: string
}): Promise<IntakeFormVersionRow> {
  return mutationVersion(await rpc('save_intake_form_draft', {
    p_actor_id: input.actorId, p_version_id: input.versionId, p_expected_lock_version: input.expectedLockVersion,
    p_definition: input.definition as unknown as Json, p_definition_hash: input.definitionHash,
  }), input.definition)
}

async function sourceDefinition(versionId: string, draftGuard = false): Promise<IntakeFormDefinition> {
  const row = await getVersionRow(versionId)
  if (!row) {
    if (draftGuard) throw Object.assign(new Error('Draft changed; refresh and try again'), { code: '40001' })
    throw new Error('Source intake form version is unavailable')
  }
  return row.definition
}
export async function createNextDraftRow(input: Actor & { sourceVersionId: string }): Promise<IntakeFormVersionRow> {
  const definition = await sourceDefinition(input.sourceVersionId)
  return mutationVersion(await rpc('create_next_intake_form_draft', {
    p_actor_id: input.actorId, p_source_version_id: input.sourceVersionId,
  }), definition)
}
export async function publishDraftRow(input: VersionInput & {
  expectedLockVersion: number; expectedDefinitionHash: string
}): Promise<IntakeFormVersionRow> {
  const definition = await sourceDefinition(input.versionId, true)
  return mutationVersion(await rpc('publish_intake_form_draft', {
    p_actor_id: input.actorId, p_version_id: input.versionId, p_expected_lock_version: input.expectedLockVersion,
    p_expected_definition_hash: input.expectedDefinitionHash,
  }), definition)
}
export async function retireVersionRow(input: VersionInput): Promise<IntakeFormVersionRow> {
  const definition = await sourceDefinition(input.versionId)
  return mutationVersion(await rpc('retire_intake_form_version', {
    p_actor_id: input.actorId, p_version_id: input.versionId,
  }), definition)
}
export async function archiveTemplateRow(input: Actor & { templateId: string; archived: boolean }): Promise<IntakeFormTemplateRow> {
  return parseTemplate(await rpc('archive_intake_form_template', {
    p_actor_id: input.actorId, p_template_id: input.templateId, p_archived: input.archived,
  }))
}
export async function discardDraftRow(input: VersionInput & { expectedLockVersion: number }): Promise<IntakeFormVersionRow> {
  const definition = await sourceDefinition(input.versionId, true)
  return mutationVersion(await rpc('discard_intake_form_draft', {
    p_actor_id: input.actorId, p_version_id: input.versionId, p_expected_lock_version: input.expectedLockVersion,
  }), definition)
}
