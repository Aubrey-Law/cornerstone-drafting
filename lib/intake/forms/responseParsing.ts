import { z } from 'zod'
import type { IntakeFormEditorSnapshot, IntakeFormVersionRow } from './persistenceTypes'
import { parseIntakeFormDefinition } from './schema'
import { definitionFingerprint } from './editorState'
import type { IntakeFormDefinition } from './types'

const timestamp = z.string().datetime({ offset: true })
export const templateSchema = z.object({
  purpose: z.enum(['client_intake', 'discovery_call']).optional(),
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), name: z.string().min(1).max(160), description: z.string().max(600).nullable(), archived_at: timestamp.nullable(),
  created_by: z.string().min(1), created_at: timestamp, updated_at: timestamp,
}).strict()
const versionSchema = z.object({
  id: z.string().min(1), template_id: z.string(), version: z.number().int().positive(), status: z.enum(['draft', 'published', 'retired']),
  definition: z.unknown(), definition_hash: z.string().regex(/^[0-9a-f]{64}$/), lock_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  created_by: z.string(), created_at: z.string(), updated_at: z.string(), published_at: z.string().nullable(), published_by: z.string().nullable(),
}).strict()
const auditSchema = z.object({
  id: z.string(), template_id: z.string(), version_id: z.string().nullable(), version_number: z.number().int().positive().nullable(),
  action: z.enum(['create', 'save', 'create_next_draft', 'publish', 'retire', 'archive', 'restore', 'duplicate', 'discard']),
  actor_id: z.string(), occurred_at: z.string(), metadata: z.record(z.unknown()),
}).strict()
export const invalidResponse = () => new Error('The server returned an invalid intake form response. Your local changes are preserved; retry or reload latest.')
export function parseVersion(raw: unknown, template: IntakeFormEditorSnapshot['template'], status?: IntakeFormVersionRow['status'], id?: string): IntakeFormVersionRow {
  const parsed = versionSchema.safeParse(raw)
  if (!parsed.success) throw invalidResponse()
  const definition = parseIntakeFormDefinition(parsed.data.definition)
  if (!definition.success || parsed.data.template_id !== template.id || definition.data.key !== template.key ||
    (status && parsed.data.status !== status) || (id && parsed.data.id !== id)) throw invalidResponse()
  return { ...parsed.data, definition: definition.data }
}
export function parseSnapshot(raw: unknown, expected: IntakeFormEditorSnapshot['template']): IntakeFormEditorSnapshot {
  const envelope = z.object({ template: templateSchema, draft: z.unknown(), versions: z.array(z.unknown()), auditEvents: z.array(auditSchema) }).strict().safeParse(raw)
  if (!envelope.success || envelope.data.template.id !== expected.id || envelope.data.template.key !== expected.key) throw invalidResponse()
  const { template } = envelope.data
  const versions = envelope.data.versions.map(value => parseVersion(value, template))
  const draft = envelope.data.draft === null ? null : parseVersion(envelope.data.draft, template, 'draft')
  const drafts = versions.filter(version => version.status === 'draft')
  if (new Set(versions.map(version => version.id)).size !== versions.length || drafts.length !== (draft ? 1 : 0) ||
    (draft && JSON.stringify(drafts[0]) !== JSON.stringify(draft)) || envelope.data.auditEvents.some(event => event.template_id !== template.id)) throw invalidResponse()
  // JSON came through response.json; the schema above validates all event metadata before adoption.
  return { template, versions, draft, auditEvents: envelope.data.auditEvents as IntakeFormEditorSnapshot['auditEvents'] }
}

export function parseCreatedForm(raw: unknown, expected: { key: string; name: string; description: string | null; definition: IntakeFormDefinition; existingIds: string[] }) {
  const envelope = z.object({ template: templateSchema, draft: z.unknown(), diagnostics: z.array(z.object({ path: z.string(), message: z.string() }).strict()) }).strict().safeParse(raw)
  if (!envelope.success) throw invalidResponse()
  const { template } = envelope.data
  const draft = parseVersion(envelope.data.draft, template, 'draft')
  if (template.key !== expected.key || template.name !== expected.name || template.description !== expected.description || template.archived_at !== null ||
    expected.existingIds.includes(template.id) || draft.version !== 1 || draft.lock_version !== 0 || draft.published_at !== null || draft.published_by !== null ||
    draft.created_by !== template.created_by || definitionFingerprint(draft.definition) !== definitionFingerprint(expected.definition)) throw invalidResponse()
  return { ...envelope.data, draft }
}

export function parseArchiveResponse(raw: unknown, expected: IntakeFormEditorSnapshot['template'], archived: boolean) {
  const envelope = z.object({ template: templateSchema }).strict().safeParse(raw)
  if (!envelope.success) throw invalidResponse()
  const { template } = envelope.data
  if (template.id !== expected.id || template.key !== expected.key || Boolean(template.archived_at) !== archived ||
    template.name !== expected.name || template.description !== expected.description || template.created_by !== expected.created_by || template.created_at !== expected.created_at) throw invalidResponse()
  return template
}
