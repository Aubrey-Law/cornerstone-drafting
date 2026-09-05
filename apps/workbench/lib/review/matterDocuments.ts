import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { reviewableDocuments, type DocumentVersionRow, type ReviewableDocument } from './documents'

export interface MatterDocuments {
  matterId: string
  title: string
  documents: ReviewableDocument[]
}

/**
 * Every document on a hired matter that a review could read.
 *
 * `matter_documents.matter_id` is `text` with no foreign key, a wart of the old
 * schema, so the join is done here rather than in the query.
 */
export async function loadReviewableByMatter(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<MatterDocuments[]> {
  const sb = client

  const { data: matters, error: matterError } = await sb
    .from('matters')
    .select('id, name')
    .eq('relationship_status', 'hired')
  if (matterError) throw new Error(`Could not load matters: ${matterError.message}`)
  if (!matters || matters.length === 0) return []

  const matterIds = matters.map((m) => String(m.id))
  const { data: documents, error: documentError } = await sb
    .from('matter_documents')
    .select('id, matter_id, name, superseded_at')
    .in('matter_id', matterIds)
    .is('superseded_at', null)
  if (documentError) throw new Error(`Could not load documents: ${documentError.message}`)
  if (!documents || documents.length === 0) return []

  const { data: versions, error: versionError } = await sb
    .from('document_versions')
    .select('id, document_id, version_number, r2_key, pdf_r2_key, filename, deleted_at')
    .in('document_id', documents.map((d) => String(d.id)))
    .is('deleted_at', null)
  if (versionError) throw new Error(`Could not load versions: ${versionError.message}`)

  const documentById = new Map(documents.map((d) => [String(d.id), d]))

  const rowsByMatter = new Map<string, DocumentVersionRow[]>()
  for (const version of versions ?? []) {
    const document = documentById.get(String(version.document_id))
    if (!document) continue
    const matterId = String(document.matter_id)
    const row: DocumentVersionRow = {
      documentId: String(document.id),
      name: String(document.name),
      versionId: String(version.id),
      versionNumber: Number(version.version_number ?? 1),
      r2Key: String(version.r2_key),
      pdfR2Key: (version.pdf_r2_key as string | null) ?? null,
      filename: (version.filename as string | null) ?? null,
      supersededAt: (document.superseded_at as string | null) ?? null,
      deletedAt: (version.deleted_at as string | null) ?? null,
    }
    const existing = rowsByMatter.get(matterId)
    if (existing) existing.push(row)
    else rowsByMatter.set(matterId, [row])
  }

  return matters
    .map((matter) => ({
      matterId: String(matter.id),
      title: (matter.name as string | null) ?? 'Untitled matter',
      documents: reviewableDocuments(rowsByMatter.get(String(matter.id)) ?? []),
    }))
    .filter((matter) => matter.documents.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export interface ResolvedDocument {
  versionId: string
  documentId: string
  matterId: string
  name: string
  source: ReviewableDocument['source']
}

/**
 * Resolves a version id the client asked for into the object to read.
 *
 * The client sends an id and never a storage key. A key from the browser would
 * be an arbitrary read against the bucket holding every client's documents,
 * which is a different and much worse thing than a review. The key comes from
 * the database or the request is refused.
 *
 * It must also still be current: reviewing a superseded draft produces findings
 * about language nobody will sign, with nothing in them to say so.
 */
export function resolveReviewableDocument(
  byMatter: readonly MatterDocuments[],
  versionId: string,
): ResolvedDocument | null {
  for (const matter of byMatter) {
    const found = matter.documents.find((document) => document.versionId === versionId)
    if (found) {
      return {
        versionId: found.versionId,
        documentId: found.documentId,
        matterId: matter.matterId,
        name: found.name,
        source: found.source,
      }
    }
  }
  return null
}
