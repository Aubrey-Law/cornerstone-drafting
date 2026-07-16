import type { EstateClauseManifestEntry } from '@/lib/estateClauses/types'

export interface GeneratedEstateDocumentMetadata {
  matter_id: string
  r2_key: string
  name: string
  size: number
  content_type: string
  folder: 'draft'
  actor_id: string
  generation_id: string
  generation_engine: 'node'
  marker_count: number
  missing_count: number
  template_id: string | null
  template_version_id: string | null
}

export interface GeneratedEstateDocumentPersistenceClient {
  rpc(
    name: 'persist_generated_estate_document',
    params: {
      p_document: GeneratedEstateDocumentMetadata
      p_manifest: EstateClauseManifestEntry[]
    },
  ): PromiseLike<{
    data: { documentId?: unknown; documentVersionId?: unknown } | null
    error: { message: string } | null
  }>
}

export async function persistGeneratedEstateDocument(args: {
  admin: GeneratedEstateDocumentPersistenceClient
  document: GeneratedEstateDocumentMetadata
  manifest: EstateClauseManifestEntry[]
}): Promise<{ documentId: string; documentVersionId: string }> {
  const { data, error } = await args.admin.rpc('persist_generated_estate_document', {
    p_document: args.document,
    p_manifest: args.manifest,
  })
  if (error) throw new Error(error.message)
  if (typeof data?.documentId !== 'string' || typeof data.documentVersionId !== 'string') {
    throw new Error('Generated document persistence returned no identifiers')
  }
  return {
    documentId: data.documentId,
    documentVersionId: data.documentVersionId,
  }
}
