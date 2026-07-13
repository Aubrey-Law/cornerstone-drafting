import fs from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sha256 } from './docx'
import { documentTemplateDefinitionForPath, getDocumentTemplateDefinition } from './registry'
import type { DocumentTemplateDefinition, ResolvedDocumentTemplate } from './types'

const BUCKET = 'document-template-versions'

function migrationMissing(message: string): boolean {
  const value = message.toLowerCase()
  return value.includes('document_template_publications') && (value.includes('does not exist') || value.includes('schema cache'))
}

async function bundled(definition: DocumentTemplateDefinition): Promise<ResolvedDocumentTemplate> {
  const buffer = await fs.readFile(path.join(process.cwd(), definition.bundledPath))
  return {
    definition,
    buffer,
    source: 'bundled',
    versionId: null,
    versionLabel: 'Bundled',
    sha256: sha256(buffer),
  }
}

export async function resolveDocumentTemplate(
  templateId: string,
  client: SupabaseClient = getAdminClient() as unknown as SupabaseClient,
): Promise<ResolvedDocumentTemplate> {
  const definition = getDocumentTemplateDefinition(templateId)
  if (!definition) throw new Error(`Unknown document template: ${templateId}`)

  const { data, error } = await client
    .from('document_template_publications')
    .select('version_id, document_template_versions!inner(id, version_number, storage_path, sha256)')
    .eq('template_id', templateId)
    .maybeSingle()

  if (error) {
    if (migrationMissing(error.message)) return bundled(definition)
    throw new Error(`Could not resolve active template ${templateId}: ${error.message}`)
  }
  if (!data) return bundled(definition)

  const joined = data.document_template_versions as unknown as {
    id: string
    version_number: number
    storage_path: string
    sha256: string
  }
  const { data: blob, error: downloadError } = await client.storage.from(BUCKET).download(joined.storage_path)
  if (downloadError || !blob) {
    throw new Error(`Published template ${templateId} is unavailable: ${downloadError?.message ?? 'empty object'}`)
  }
  const buffer = Buffer.from(await blob.arrayBuffer())
  const actualHash = sha256(buffer)
  if (actualHash !== joined.sha256) {
    throw new Error(`Published template ${templateId} failed its integrity check`)
  }
  return {
    definition,
    buffer,
    source: 'published',
    versionId: joined.id,
    versionLabel: `v${joined.version_number}`,
    sha256: actualHash,
  }
}

export async function resolveDocumentTemplateForBundledPath(
  bundledPath: string,
  client?: SupabaseClient,
): Promise<ResolvedDocumentTemplate> {
  const definition = documentTemplateDefinitionForPath(bundledPath)
  if (!definition) throw new Error(`No registered template for ${bundledPath}`)
  return resolveDocumentTemplate(definition.id, client)
}

