import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sha256 } from '@/lib/documentTemplates/docx'
import { extractTemplateVariables } from '@/lib/estateGenerator/templateVariables'

const BUCKET = 'document-template-versions'
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_BYTES = 15728640

export interface TemplateBuilderUploadRow {
  id: string
  filename: string
  storage_path: string
  original_storage_path: string
  byte_size: number
  sha256: string
  revision: number
  created_by: string | null
  created_at: string
  updated_at: string
}

function admin(): SupabaseClient {
  return getAdminClient() as unknown as SupabaseClient
}

function migrationMissing(message: string): boolean {
  const value = message.toLowerCase()
  return value.includes('template_builder_uploads') && (value.includes('does not exist') || value.includes('schema cache'))
}

function migrationError(): Error {
  return new Error('Template Builder requires the template_builder_uploads migration. Apply the latest Supabase migrations and retry.')
}

export async function createTemplateBuilderUpload(args: {
  filename: string
  buffer: Buffer
  actorId: string
}, client: SupabaseClient = admin()): Promise<TemplateBuilderUploadRow> {
  if (args.buffer.length === 0 || args.buffer.length > MAX_BYTES) {
    throw new Error('Template file must be a DOCX under 15 MB.')
  }
  // PizZip rejects non-zip buffers — fail loudly before anything is stored.
  try {
    extractTemplateVariables(args.buffer)
  } catch {
    throw new Error('That file is not a readable DOCX document.')
  }

  const hash = sha256(args.buffer)
  const { data: inserted, error: insertError } = await client
    .from('template_builder_uploads')
    .insert({
      filename: args.filename.endsWith('.docx') ? args.filename : `${args.filename}.docx`,
      // Placeholder paths — replaced right after we know the row id.
      storage_path: `builder/pending-${hash}`,
      original_storage_path: `builder/pending-${hash}`,
      byte_size: args.buffer.length,
      sha256: hash,
      created_by: args.actorId,
    })
    .select('*')
    .single()
  if (insertError || !inserted) {
    if (insertError && migrationMissing(insertError.message)) throw migrationError()
    throw new Error(`Could not register the upload: ${insertError?.message ?? 'no row returned'}`)
  }
  const row = inserted as TemplateBuilderUploadRow

  const originalPath = `builder/${row.id}/original.docx`
  const { error: uploadError } = await client.storage.from(BUCKET).upload(originalPath, args.buffer, {
    contentType: DOCX_CONTENT_TYPE,
    upsert: true,
  })
  if (uploadError) {
    await client.from('template_builder_uploads').delete().eq('id', row.id)
    throw new Error(`Could not store the uploaded file: ${uploadError.message}`)
  }

  const { data: updated, error: updateError } = await client
    .from('template_builder_uploads')
    .update({ storage_path: originalPath, original_storage_path: originalPath })
    .eq('id', row.id)
    .select('*')
    .single()
  if (updateError || !updated) {
    throw new Error(`Could not finalize the upload: ${updateError?.message ?? 'no row returned'}`)
  }
  return updated as TemplateBuilderUploadRow
}

export async function getTemplateBuilderUpload(
  uploadId: string,
  client: SupabaseClient = admin(),
): Promise<TemplateBuilderUploadRow | null> {
  const { data, error } = await client
    .from('template_builder_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle()
  if (error) {
    if (migrationMissing(error.message)) throw migrationError()
    throw new Error(`Could not load the upload: ${error.message}`)
  }
  return (data as TemplateBuilderUploadRow | null) ?? null
}

/** Download the current working copy with an integrity check. */
export async function loadTemplateBuilderBuffer(
  row: TemplateBuilderUploadRow,
  client: SupabaseClient = admin(),
): Promise<Buffer> {
  const { data: blob, error } = await client.storage.from(BUCKET).download(row.storage_path)
  if (error || !blob) {
    throw new Error(`Upload "${row.filename}" is unavailable: ${error?.message ?? 'empty object'}`)
  }
  const buffer = Buffer.from(await blob.arrayBuffer())
  if (sha256(buffer) !== row.sha256) {
    throw new Error(`Upload "${row.filename}" failed its integrity check`)
  }
  return buffer
}

/** Store a revised working copy (original is never overwritten). */
export async function saveTemplateBuilderRevision(
  row: TemplateBuilderUploadRow,
  buffer: Buffer,
  client: SupabaseClient = admin(),
): Promise<TemplateBuilderUploadRow> {
  const revision = row.revision + 1
  const revisionPath = `builder/${row.id}/rev-${revision}.docx`
  const { error: uploadError } = await client.storage.from(BUCKET).upload(revisionPath, buffer, {
    contentType: DOCX_CONTENT_TYPE,
    upsert: true,
  })
  if (uploadError) {
    throw new Error(`Could not store the revised file: ${uploadError.message}`)
  }
  const { data, error } = await client
    .from('template_builder_uploads')
    .update({
      storage_path: revisionPath,
      byte_size: buffer.length,
      sha256: sha256(buffer),
      revision,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`Could not record the revision: ${error?.message ?? 'no row returned'}`)
  }
  return data as TemplateBuilderUploadRow
}
