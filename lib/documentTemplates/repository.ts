import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { DOCX_CONTENT_TYPE, sha256 } from './docx'
import { getDocumentTemplateRegistry } from './registry'

export const DOCUMENT_TEMPLATE_BUCKET = 'document-template-versions'

type LooseClient = SupabaseClient

export function documentTemplateAdminClient(): LooseClient {
  return getAdminClient() as unknown as LooseClient
}

export function isTemplateMigrationMissing(message: string): boolean {
  const value = message.toLowerCase()
  return value.includes('document_template_') && (value.includes('does not exist') || value.includes('schema cache'))
}

export async function listDocumentTemplates(client = documentTemplateAdminClient()) {
  const [{ data: versions, error: versionsError }, { data: publications, error: publicationsError }] = await Promise.all([
    client.from('document_template_versions').select('*').order('created_at', { ascending: false }),
    client.from('document_template_publications').select('*'),
  ])
  const error = versionsError ?? publicationsError
  if (error && !isTemplateMigrationMissing(error.message)) throw new Error(error.message)
  const migrationRequired = Boolean(error)
  const versionRows = (versions ?? []) as Array<Record<string, unknown>>
  const publicationRows = (publications ?? []) as Array<Record<string, unknown>>

  return {
    migrationRequired,
    templates: getDocumentTemplateRegistry().map(definition => {
      const history = versionRows.filter(row => row.template_id === definition.id)
      const publication = publicationRows.find(row => row.template_id === definition.id) ?? null
      return {
        ...definition,
        activeVersionId: publication?.version_id ?? null,
        publishedAt: publication?.published_at ?? null,
        publishedBy: publication?.published_by ?? null,
        activeSource: publication ? 'published' : 'bundled',
        versions: history.map(row => ({
          id: row.id,
          versionNumber: row.version_number,
          originalFilename: row.original_filename,
          byteSize: row.byte_size,
          sha256: row.sha256,
          validationStatus: row.validation_status,
          validationReport: row.validation_report,
          validatedWithMatterId: row.validated_with_matter_id,
          uploadedBy: row.uploaded_by,
          validatedBy: row.validated_by,
          validatedAt: row.validated_at,
          createdAt: row.created_at,
          isActive: publication?.version_id === row.id,
        })),
      }
    }),
  }
}

export async function createDocumentTemplateVersion(args: {
  templateId: string
  filename: string
  buffer: Buffer
  actorId: string
  client?: LooseClient
}) {
  const client = args.client ?? documentTemplateAdminClient()
  const id = randomUUID()
  const hash = sha256(args.buffer)
  const storagePath = `${args.templateId}/${id}.docx`
  const { data: duplicate } = await client
    .from('document_template_versions')
    .select('id')
    .eq('template_id', args.templateId)
    .eq('sha256', hash)
    .maybeSingle()
  if (duplicate) throw new Error('This exact template file has already been uploaded.')

  const { error: uploadError } = await client.storage
    .from(DOCUMENT_TEMPLATE_BUCKET)
    .upload(storagePath, args.buffer, { contentType: DOCX_CONTENT_TYPE, upsert: false })
  if (uploadError) throw new Error(`Template upload failed: ${uploadError.message}`)

  const { data, error } = await client.from('document_template_versions').insert({
    id,
    template_id: args.templateId,
    storage_path: storagePath,
    original_filename: args.filename,
    byte_size: args.buffer.length,
    sha256: hash,
    uploaded_by: args.actorId,
  }).select('*').single()
  if (error) {
    await client.storage.from(DOCUMENT_TEMPLATE_BUCKET).remove([storagePath])
    throw new Error(error.message)
  }
  await client.from('document_template_events').insert({
    template_id: args.templateId,
    version_id: id,
    event_type: 'uploaded',
    actor_id: args.actorId,
    metadata: { filename: args.filename, sha256: hash },
  })
  return data
}

export async function getDocumentTemplateVersion(templateId: string, versionId: string, client = documentTemplateAdminClient()) {
  const { data, error } = await client
    .from('document_template_versions')
    .select('*')
    .eq('id', versionId)
    .eq('template_id', templateId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Template version not found')
  return data as Record<string, unknown>
}

export async function downloadDocumentTemplateVersion(templateId: string, versionId: string, client = documentTemplateAdminClient()) {
  const version = await getDocumentTemplateVersion(templateId, versionId, client)
  const { data, error } = await client.storage
    .from(DOCUMENT_TEMPLATE_BUCKET)
    .download(String(version.storage_path))
  if (error || !data) throw new Error(`Template version is unavailable: ${error?.message ?? 'empty object'}`)
  const buffer = Buffer.from(await data.arrayBuffer())
  if (sha256(buffer) !== version.sha256) throw new Error('Template version failed its integrity check')
  return { version, buffer }
}

export async function recordDocumentTemplateValidation(args: {
  templateId: string
  versionId: string
  matterId: string
  actorId: string
  report: Record<string, unknown>
  valid: boolean
  client?: LooseClient
}) {
  const client = args.client ?? documentTemplateAdminClient()
  const now = new Date().toISOString()
  const { error } = await client.from('document_template_versions').update({
    validation_status: args.valid ? 'valid' : 'invalid',
    validation_report: args.report,
    validated_with_matter_id: args.matterId,
    validated_by: args.actorId,
    validated_at: now,
  }).eq('id', args.versionId).eq('template_id', args.templateId)
  if (error) throw new Error(error.message)
  await client.from('document_template_events').insert({
    template_id: args.templateId,
    version_id: args.versionId,
    event_type: args.valid ? 'validated' : 'validation_failed',
    actor_id: args.actorId,
    metadata: { matterId: args.matterId, report: args.report },
  })
}

