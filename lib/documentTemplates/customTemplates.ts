import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { extractTemplateVariables } from '@/lib/estateGenerator/templateVariables'
import { sha256 } from './docx'

const BUCKET = 'document-template-versions'

/** Quick-draft template ids for custom templates are `custom-<uuid>`. */
export const CUSTOM_TEMPLATE_ID_PREFIX = 'custom-'

export function customTemplateId(rowId: string): string {
  return `${CUSTOM_TEMPLATE_ID_PREFIX}${rowId}`
}

export function customTemplateRowId(templateId: string): string | null {
  return templateId.startsWith(CUSTOM_TEMPLATE_ID_PREFIX)
    ? templateId.slice(CUSTOM_TEMPLATE_ID_PREFIX.length)
    : null
}

export interface CustomTemplateRow {
  id: string
  label: string
  output_filename: string
  storage_path: string
  byte_size: number
  sha256: string
  variables: string[]
  clauses: string[]
  created_at: string
  archived_at: string | null
}

function migrationMissing(message: string): boolean {
  const value = message.toLowerCase()
  return value.includes('custom_document_templates') && (value.includes('does not exist') || value.includes('schema cache'))
}

function admin(): SupabaseClient {
  return getAdminClient() as unknown as SupabaseClient
}

export interface CustomTemplatesList {
  templates: CustomTemplateRow[]
  /** True when the custom_document_templates migration has not been applied. */
  migrationRequired: boolean
}

export async function listCustomTemplates(client: SupabaseClient = admin()): Promise<CustomTemplatesList> {
  const { data, error } = await client
    .from('custom_document_templates')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    if (migrationMissing(error.message)) return { templates: [], migrationRequired: true }
    throw new Error(`Could not list custom templates: ${error.message}`)
  }
  return { templates: (data ?? []) as CustomTemplateRow[], migrationRequired: false }
}

export async function getCustomTemplate(rowId: string, client: SupabaseClient = admin()): Promise<CustomTemplateRow | null> {
  const { data, error } = await client
    .from('custom_document_templates')
    .select('*')
    .eq('id', rowId)
    .is('archived_at', null)
    .maybeSingle()
  if (error) {
    if (migrationMissing(error.message)) return null
    throw new Error(`Could not load custom template: ${error.message}`)
  }
  return (data as CustomTemplateRow | null) ?? null
}

/** Download the DOCX for a custom template with an integrity check. */
export async function resolveCustomTemplateBuffer(
  row: CustomTemplateRow,
  client: SupabaseClient = admin(),
): Promise<Buffer> {
  const { data: blob, error } = await client.storage.from(BUCKET).download(row.storage_path)
  if (error || !blob) {
    throw new Error(`Custom template "${row.label}" is unavailable: ${error?.message ?? 'empty object'}`)
  }
  const buffer = Buffer.from(await blob.arrayBuffer())
  if (sha256(buffer) !== row.sha256) {
    throw new Error(`Custom template "${row.label}" failed its integrity check`)
  }
  return buffer
}

export interface CreateCustomTemplateArgs {
  label: string
  buffer: Buffer
  actorId: string
  outputFilename?: string
}

export async function createCustomTemplate(
  args: CreateCustomTemplateArgs,
  client: SupabaseClient = admin(),
): Promise<CustomTemplateRow> {
  const label = args.label.trim()
  if (!label) throw new Error('A template label is required.')
  if (args.buffer.length === 0 || args.buffer.length > 15728640) {
    throw new Error('Template file must be a DOCX under 15 MB.')
  }

  // Fails loudly on non-DOCX uploads (PizZip rejects non-zip buffers) and
  // captures the variable report shown in the picker and upload response.
  let report
  try {
    report = extractTemplateVariables(args.buffer)
  } catch {
    throw new Error('That file is not a readable DOCX template.')
  }

  const hash = sha256(args.buffer)
  const outputFilename = (args.outputFilename?.trim() || `${label.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()}.docx`)
  const storagePath = `custom/${hash}.docx`

  const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, args.buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  })
  if (uploadError) {
    throw new Error(`Could not store the template file: ${uploadError.message}`)
  }

  const { data, error } = await client
    .from('custom_document_templates')
    .insert({
      label,
      output_filename: outputFilename.endsWith('.docx') ? outputFilename : `${outputFilename}.docx`,
      storage_path: storagePath,
      byte_size: args.buffer.length,
      sha256: hash,
      variables: report.variables,
      clauses: report.clauses,
      created_by: args.actorId,
    })
    .select('*')
    .single()
  if (error) {
    if (migrationMissing(error.message)) {
      throw new Error('Custom templates require the custom_document_templates migration. Apply the latest Supabase migrations and retry.')
    }
    throw new Error(`Could not register the custom template: ${error.message}`)
  }
  return data as CustomTemplateRow
}

export async function archiveCustomTemplate(rowId: string, client: SupabaseClient = admin()): Promise<void> {
  const { error } = await client
    .from('custom_document_templates')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', rowId)
  if (error && !migrationMissing(error.message)) {
    throw new Error(`Could not archive the custom template: ${error.message}`)
  }
}
